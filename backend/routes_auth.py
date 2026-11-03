from datetime import date, datetime
from uuid import UUID
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from db import with_db_context
from security import (
    check_rate_limit, record_failure, clear_failures,
    verify_password, create_token
)

router = APIRouter()

# --- Models ---

class StudentLogin(BaseModel):
    school_id: UUID
    registration_number: str
    dob: str

class TeacherLogin(BaseModel):
    school_id: UUID
    username: str
    password: str

class AdminLogin(BaseModel):
    username: str
    password: str

# --- Routes ---

@router.get("/api/schools")
def get_schools():
    with with_db_context("auth_role") as cur:
        return cur.execute("SELECT id, name FROM schools ORDER BY name").fetchall()

@router.post("/api/auth/student/login")
def student_login(req: StudentLogin):
    reg_no = req.registration_number.strip()
    key = f"student:{req.school_id}:{reg_no}"
    check_rate_limit(key)

    dob_str = req.dob.strip()
    parsed_dob = None
    if len(dob_str) == 8 and dob_str.isdigit():
        try:
            parsed_dob = datetime.strptime(dob_str, "%d%m%Y").date()
        except ValueError:
            pass

    if not parsed_dob:
        record_failure(key)
        raise HTTPException(401, "Invalid credentials")

    with with_db_context("auth_role") as cur:
        row = cur.execute("""
            SELECT st.id, st.full_name, st.registration_number, st.school_id, st.class_id,
                   sc.name AS school_name, c.name AS class_name,
                   (now() AT TIME ZONE 'Asia/Kolkata')::date BETWEEN sub.start_date AND sub.end_date AS active
            FROM students st
            JOIN schools sc ON sc.id = st.school_id
            JOIN classes c ON c.id = st.class_id
            JOIN subscriptions sub ON sub.school_id = st.school_id AND sub.class_id = st.class_id
            WHERE st.school_id = %s AND st.registration_number = %s AND st.dob = %s
        """, (str(req.school_id), reg_no, parsed_dob)).fetchone()

    if not row:
        record_failure(key)
        raise HTTPException(401, "Invalid credentials")
    if not row["active"]:
        raise HTTPException(403, "Subscription for this class is not active or has expired.")

    clear_failures(key)
    return {"token": create_token({
        "role": "student", "user_id": str(row["id"]), "school_id": str(row["school_id"]), 
        "class_id": row["class_id"], "full_name": row["full_name"], 
        "school_name": row["school_name"], "class_name": row["class_name"], 
        "registration_number": row["registration_number"]
    })}

@router.post("/api/auth/teacher/login")
def teacher_login(req: TeacherLogin):
    key = f"teacher:{req.school_id}:{req.username}"
    check_rate_limit(key)

    with with_db_context("auth_role") as cur:
        row = cur.execute("""
            SELECT t.id, t.full_name, t.username, t.school_id, t.class_id, t.password_hash,
                   sc.name AS school_name, c.name AS class_name,
                   (now() AT TIME ZONE 'Asia/Kolkata')::date BETWEEN sub.start_date AND sub.end_date AS active
            FROM teachers t
            JOIN schools sc ON sc.id = t.school_id
            JOIN classes c ON c.id = t.class_id
            JOIN subscriptions sub ON sub.school_id = t.school_id AND sub.class_id = t.class_id
            WHERE t.school_id = %s AND t.username = %s
        """, (str(req.school_id), req.username)).fetchone()

    if not row or not verify_password(req.password, row["password_hash"]):
        record_failure(key)
        raise HTTPException(401, "Invalid credentials")
    if not row["active"]:
        raise HTTPException(403, "Subscription for this class is not active or has expired.")

    clear_failures(key)
    return {"token": create_token({
        "role": "teacher", "user_id": str(row["id"]), "school_id": str(row["school_id"]), 
        "class_id": row["class_id"], "full_name": row["full_name"], 
        "school_name": row["school_name"], "class_name": row["class_name"], 
        "username": row["username"]
    })}

@router.post("/api/auth/admin/login")
def admin_login(req: AdminLogin):
    key = f"admin:{req.username}"
    check_rate_limit(key)

    with with_db_context("auth_role") as cur:
        row = cur.execute(
            "SELECT id, username, password_hash FROM platform_admins WHERE username = %s", 
            (req.username,)
        ).fetchone()

    if not row or not verify_password(req.password, row["password_hash"]):
        record_failure(key)
        raise HTTPException(401, "Invalid credentials")

    clear_failures(key)
    return {"token": create_token({
        "role": "admin", "user_id": str(row["id"]), "school_id": None, 
        "class_id": None, "full_name": "Admin", "username": row["username"]
    })}
