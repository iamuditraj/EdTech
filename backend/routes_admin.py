import csv
import io
import json
from datetime import date, datetime
from uuid import UUID
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, model_validator

from db import with_db_context
from security import hash_password, require_role

# Lock every endpoint on this router to platform admins only
router = APIRouter(prefix="/api/admin", dependencies=[Depends(require_role("admin"))])


# --- Models ---

class SchoolCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)

class ClassCreate(BaseModel):
    id: int
    name: str = Field(min_length=1, max_length=255)

class SubscriptionUpsert(BaseModel):
    school_id: UUID
    class_id: int
    start_date: date
    end_date: date
    total_seats: int = Field(gt=0)

    @model_validator(mode="after")
    def check_dates(self):
        if self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date.")
        return self

class McqItem(BaseModel):
    question: str = Field(min_length=1)
    options: list[str] = Field(min_length=2, max_length=6)
    correct_index: int = Field(ge=0)

    @model_validator(mode="after")
    def check_index(self):
        if self.correct_index >= len(self.options):
            raise ValueError("correct_index out of range.")
        return self

class VideoCreate(BaseModel):
    class_id: int
    title: str = Field(min_length=1, max_length=255)
    video_url: str = Field(min_length=1)
    total_duration_seconds: int = Field(gt=0)
    completion_threshold_pct: float = Field(ge=1, le=100)
    notes_url: str | None = None
    mcqs: list[McqItem] = []

class TeacherUpsert(BaseModel):
    school_id: UUID
    class_id: int
    full_name: str = Field(min_length=1, max_length=255)
    username: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=1, max_length=72)


# --- Helpers ---

def _parse_dob(val: str) -> date | None:
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(val, fmt).date()
        except ValueError:
            continue
    return None

def parse_student_csv(raw_bytes: bytes) -> tuple[list[tuple[str, date, str]], list[dict]]:
    try:
        text = raw_bytes.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(400, "CSV file must be UTF-8 encoded.")

    reader = csv.reader(io.StringIO(text))
    header = next(reader, None)
    if not header:
        raise HTTPException(400, "CSV file is empty.")

    cols = [c.strip().lower() for c in header]
    if not {"name", "regno", "dob"}.issubset(cols):
        raise HTTPException(400, "CSV header must contain columns: name, regno, dob")

    i_name, i_reg, i_dob = cols.index("name"), cols.index("regno"), cols.index("dob")
    rows, errors, seen_regnos = [], [], set()

    for line_no, line in enumerate(reader, start=2):
        if not any(cell.strip() for cell in line):
            continue
        name = line[i_name].strip() if len(line) > i_name else ""
        regno = line[i_reg].strip() if len(line) > i_reg else ""
        dob_str = line[i_dob].strip() if len(line) > i_dob else ""

        if not name or not regno or not dob_str:
            errors.append({"row": line_no, "problem": "Missing name, regno, or dob."})
            continue

        if regno in seen_regnos:
            errors.append({"row": line_no, "problem": f"Duplicate regno '{regno}' in CSV."})
        seen_regnos.add(regno)

        dob = _parse_dob(dob_str)
        if not dob:
            errors.append({"row": line_no, "problem": f"Invalid dob '{dob_str}'. Use YYYY-MM-DD, DD-MM-YYYY, or DD/MM/YYYY."})
            continue

        rows.append((regno, dob, name))

    if not rows and not errors:
        raise HTTPException(400, "CSV contains no student rows.")
    return rows, errors


# --- Schools ---

@router.post("/schools")
def create_school(req: SchoolCreate):
    with with_db_context("admin_role") as cur:
        row = cur.execute(
            "INSERT INTO schools (name) VALUES (%s) RETURNING id, name, created_at",
            (req.name.strip(),),
        ).fetchone()
    return row

@router.delete("/schools/{school_id}")
def delete_school(school_id: UUID):
    with with_db_context("admin_role") as cur:
        cur.execute("DELETE FROM schools WHERE id = %s", (str(school_id),))
        if cur.rowcount == 0:
            raise HTTPException(404, "School not found.")
    return {"deleted": True}


# --- Classes ---

@router.get("/classes")
def get_classes():
    with with_db_context("admin_role") as cur:
        rows = cur.execute("SELECT id, name FROM classes ORDER BY id").fetchall()
    return rows

@router.post("/classes")
def create_class(req: ClassCreate):
    with with_db_context("admin_role") as cur:
        row = cur.execute(
            "INSERT INTO classes (id, name) VALUES (%s, %s) RETURNING id, name",
            (req.id, req.name.strip()),
        ).fetchone()
    return row

@router.delete("/classes/{class_id}")
def delete_class(class_id: int):
    with with_db_context("admin_role") as cur:
        cur.execute("DELETE FROM classes WHERE id = %s", (class_id,))
        if cur.rowcount == 0:
            raise HTTPException(404, "Class not found.")
    return {"deleted": True}


# --- Subscriptions ---

@router.get("/subscriptions")
def get_subscriptions():
    with with_db_context("admin_role") as cur:
        rows = cur.execute(
            "SELECT id, school_id, class_id, start_date, end_date, total_seats "
            "FROM subscriptions ORDER BY school_id, class_id"
        ).fetchall()
    return rows

@router.put("/subscriptions")
def upsert_subscription(req: SubscriptionUpsert):
    with with_db_context("admin_role") as cur:
        row = cur.execute("""
            INSERT INTO subscriptions (school_id, class_id, start_date, end_date, total_seats)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (school_id, class_id) DO UPDATE SET
                start_date = EXCLUDED.start_date,
                end_date = EXCLUDED.end_date,
                total_seats = EXCLUDED.total_seats
            RETURNING id, school_id, class_id, start_date, end_date, total_seats
        """, (str(req.school_id), req.class_id, req.start_date, req.end_date, req.total_seats)).fetchone()
    return row


# --- Videos ---

@router.get("/videos")
def get_videos():
    with with_db_context("admin_role") as cur:
        rows = cur.execute(
            "SELECT id, class_id, title, video_url, total_duration_seconds, completion_threshold_pct, "
            "notes_url, COALESCE(mcqs, '[]'::jsonb) AS mcqs "
            "FROM videos ORDER BY class_id, title"
        ).fetchall()
    return rows

@router.post("/videos")
def create_video(req: VideoCreate):
    mcqs_data = json.dumps([m.model_dump() for m in req.mcqs])
    notes_val = req.notes_url.strip() if req.notes_url else None
    with with_db_context("admin_role") as cur:
        row = cur.execute("""
            INSERT INTO videos (class_id, title, video_url, total_duration_seconds, completion_threshold_pct, notes_url, mcqs)
            VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
            RETURNING id, class_id, title, video_url, total_duration_seconds, completion_threshold_pct, notes_url, mcqs
        """, (req.class_id, req.title.strip(), req.video_url.strip(), req.total_duration_seconds, req.completion_threshold_pct, notes_val, mcqs_data)).fetchone()
    return row

@router.delete("/videos/{video_id}")
def delete_video(video_id: UUID):
    with with_db_context("admin_role") as cur:
        cur.execute("DELETE FROM videos WHERE id = %s", (str(video_id),))
        if cur.rowcount == 0:
            raise HTTPException(404, "Video not found.")
    return {"deleted": True}


# --- Teachers ---

@router.get("/teachers")
def get_teachers():
    with with_db_context("admin_role") as cur:
        rows = cur.execute(
            "SELECT id, school_id, class_id, full_name, username FROM teachers ORDER BY school_id, class_id"
        ).fetchall()
    return rows

@router.put("/teachers")
def upsert_teacher(req: TeacherUpsert):
    pw_hash = hash_password(req.password)
    with with_db_context("admin_role") as cur:
        row = cur.execute("""
            INSERT INTO teachers (school_id, class_id, full_name, username, password_hash)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (school_id, class_id) DO UPDATE SET
                full_name = EXCLUDED.full_name,
                username = EXCLUDED.username,
                password_hash = EXCLUDED.password_hash
            RETURNING id, school_id, class_id, full_name, username
        """, (str(req.school_id), req.class_id, req.full_name.strip(), req.username.strip(), pw_hash)).fetchone()
    return row

@router.delete("/teachers/{teacher_id}")
def delete_teacher(teacher_id: UUID):
    with with_db_context("admin_role") as cur:
        cur.execute("DELETE FROM teachers WHERE id = %s", (str(teacher_id),))
        if cur.rowcount == 0:
            raise HTTPException(404, "Teacher not found.")
    return {"deleted": True}


# --- Students ---

@router.get("/students")
def get_students(school_id: UUID, class_id: int | None = None):
    with with_db_context("admin_role") as cur:
        if class_id is not None:
            rows = cur.execute(
                "SELECT id, school_id, class_id, registration_number, dob, full_name "
                "FROM students WHERE school_id = %s AND class_id = %s ORDER BY full_name",
                (str(school_id), class_id),
            ).fetchall()
        else:
            rows = cur.execute(
                "SELECT id, school_id, class_id, registration_number, dob, full_name "
                "FROM students WHERE school_id = %s ORDER BY class_id, full_name",
                (str(school_id),),
            ).fetchall()
    return rows

@router.post("/students/upload-csv")
def upload_students_csv(
    school_id: UUID = Form(...),
    class_id: int = Form(...),
    file: UploadFile = File(...),
):
    # shortcut: 1MB in-memory cap, switch to streaming only if rosters exceed thousands of rows
    raw = file.file.read(1_048_577)
    if len(raw) > 1_048_576:
        raise HTTPException(400, "File exceeds 1 MB limit.")

    parsed_rows, errors = parse_student_csv(raw)
    if errors:
        return JSONResponse(status_code=422, content={"detail": "CSV validation failed.", "errors": errors})

    school_str = str(school_id)
    with with_db_context("admin_role") as cur:
        sub = cur.execute(
            "SELECT total_seats FROM subscriptions WHERE school_id = %s AND class_id = %s FOR UPDATE",
            (school_str, class_id),
        ).fetchone()
        if not sub:
            raise HTTPException(400, "Create a subscription for this class first.")

        existing = cur.execute(
            "SELECT count(*) AS cnt FROM students WHERE school_id = %s AND class_id = %s",
            (school_str, class_id),
        ).fetchone()["cnt"]
        if existing + len(parsed_rows) > sub["total_seats"]:
            rem = max(0, sub["total_seats"] - existing)
            raise HTTPException(400, f"Seat limit exceeded. {rem} seat(s) remaining.")

        regnos = [r[0] for r in parsed_rows]
        dups = cur.execute(
            "SELECT registration_number FROM students WHERE school_id = %s AND registration_number = ANY(%s)",
            (school_str, regnos),
        ).fetchall()
        if dups:
            dup_list = ", ".join(d["registration_number"] for d in dups)
            raise HTTPException(409, f"Registration numbers already exist in this school: {dup_list}")

        cur.executemany(
            "INSERT INTO students (school_id, class_id, registration_number, dob, full_name) VALUES (%s, %s, %s, %s, %s)",
            [(school_str, class_id, regno, dob, name) for regno, dob, name in parsed_rows],
        )
    return {"inserted": len(parsed_rows)}

@router.delete("/students/{student_id}")
def delete_student(student_id: UUID):
    with with_db_context("admin_role") as cur:
        cur.execute("DELETE FROM students WHERE id = %s", (str(student_id),))
        if cur.rowcount == 0:
            raise HTTPException(404, "Student not found.")
    return {"deleted": True}

@router.delete("/schools/{school_id}/classes/{class_id}/students")
def mass_delete_students(school_id: UUID, class_id: int):
    with with_db_context("admin_role") as cur:
        cur.execute(
            "DELETE FROM students WHERE school_id = %s AND class_id = %s",
            (str(school_id), class_id),
        )
        deleted = cur.rowcount
    return {"deleted": deleted}