# B2B2C EdTech Backend: Context, Decisions & Build Plan (v2)

## 1. How to use this document

This is the full context for building the backend. The database (`0002_initial_schema.sql`) is already deployed; one tiny tweak is listed in Section 5.

When helping with this project in a new chat:

* Follow every decision below. Build **one phase at a time** (Section 10) and wait for confirmation before the next phase.
* This is a **small-scale site with nothing critical**. Choose **ease and simplicity over extra features**. Basic security only (the DB roles/RLS already do the heavy lifting).
* Keep code **flat and simple**. No extra layers, no abstractions, no features that are not listed here. See Section 11 ("Not doing").

---

## 2. Tech stack (locked)

* **Python + FastAPI + Pydantic v2**, plain **sync `def` routes** (no `async def`). FastAPI runs them in a threadpool, so blocking DB calls and bcrypt are fine.
* **`psycopg` v3 + `psycopg_pool.ConnectionPool` (sync)**, raw parameterized SQL, **no ORM**.
  * Why: every request must run `SET LOCAL ROLE` + `set_config(...)` inside one transaction, and the progress upsert is one SQL statement with computed expressions. This is naturally raw SQL.
* **`bcrypt`** for admin/teacher passwords (enforce `max_length=72` in Pydantic). Students have no password.
* **`PyJWT`**, HS256, 24-hour tokens.
* **Config from environment variables:** `DATABASE_URL`, `JWT_SECRET` (32+ random characters), `CORS_ORIGINS` (comma-separated).
* **Run a single uvicorn worker** (the in-memory rate limiter depends on this). HTTPS is handled by the host/reverse proxy.

---

## 3. Project structure (7 flat files)

* `main.py`: app setup, CORS, pool open/close (lifespan), global DB error handler.
* `db.py`: connection pool (as `app_connector`) and `with_db_context`.
* `security.py`: password hashing, JWT create/decode, `require_role` dependency, login rate limiter.
* `routes_auth.py`: public school list + admin/teacher/student login (`auth_role`).
* `routes_admin.py`: all admin operations (`admin_role`).
* `routes_student.py`: video list + progress heartbeat (`student_role`).
* `routes_teacher.py`: class progress dashboard (`teacher_role`).

---

## 4. Database quick reference (matches `0002_initial_schema.sql`)

### Roles

| Role | Notes |
|---|---|
| `app_connector` | `LOGIN`, `NOINHERIT`, no table privileges. Can `SET ROLE` into the 4 roles below. If a handler forgets to switch role, queries fail with `42501`. |
| `auth_role` | `NOLOGIN`, `BYPASSRLS`. `SELECT` only on `platform_admins, teachers, students, subscriptions, schools, classes`. |
| `admin_role` | `NOLOGIN`, `BYPASSRLS`. All privileges on all tables. |
| `teacher_role` | `NOLOGIN`, RLS applies. `SELECT` on `schools, classes, videos, students, video_progress` (and `teachers` until the Section 5 tweak). |
| `student_role` | `NOLOGIN`, RLS applies. `SELECT` on `schools, classes, videos, students, video_progress`; `INSERT` on `video_progress`; `UPDATE (status, watch_duration_seconds, last_position_seconds, updated_at)` on `video_progress` only. |

### What RLS lets each role see (session settings `app.user_id`, `app.school_id`, `app.class_id`)

| Table | `teacher_role` | `student_role` |
|---|---|---|
| `students` | whole class roster | **own row only** |
| `videos` | own class | own class |
| `video_progress` | whole class (read only) | own rows (read / insert / update) |
| `teachers` | nothing after the Section 5 tweak | no grant |

### Tables and constraints the code must respect

* `schools` (`id` UUID, `name` unique). `classes` (`id` INT, **assigned manually** e.g. 9, 10; `name` unique). Neither has RLS.
* `platform_admins` (`id`, `username` unique, `password_hash`).
* `subscriptions`: unique `(school_id, class_id)`; `end_date >= start_date`; `total_seats > 0`.
* `videos`: `total_duration_seconds > 0`; **`completion_threshold_pct` is `NUMERIC(5,2)`, between 1 and 100**.
* `teachers`: unique `(school_id, username)` and **unique `(school_id, class_id)` (one teacher per school class)**. Needs an existing subscription for that `(school_id, class_id)`.
* `students`: **`registration_number` is unique per school** (not per class). Needs an existing subscription for that `(school_id, class_id)`.
* `video_progress`: unique `(student_id, video_id)`; composite FKs to `students` and `videos` with `ON DELETE CASCADE` (deleting a student wipes their progress).
* Unique-constraint names created by `name UNIQUE` / `username UNIQUE` follow Postgres defaults: `schools_name_key`, `classes_name_key`, `platform_admins_username_key`; `classes_pkey` is a duplicate class id.

---

## 5. Small DB changes to apply before building

Create `0003_tweaks.sql` and run it:

```sql
BEGIN;
-- No teacher endpoint reads the teachers table, so remove access (hides password_hash).
REVOKE SELECT ON teachers FROM teacher_role;
-- Replace the placeholder password from 0002 (use a strong one, put it in DATABASE_URL).
ALTER ROLE app_connector WITH PASSWORD 'put-a-real-password-here';
COMMIT;
```

* If `db_tests.sql` has a test where a teacher reads their own `teachers` row, update it to expect a permission error (`42501`) instead. The `teacher_self_read` policy can stay (harmless).
* `student_role` keeps `SELECT` on `students`: the policy limits it to the student's own row, which is fine.

---

## 6. Core engine (`db.py`, `main.py`)

### `with_db_context`: every DB operation goes through this

```python
# db.py
import os
from contextlib import contextmanager
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

pool = ConnectionPool(os.environ["DATABASE_URL"], min_size=2, max_size=10, timeout=10, open=False)

ALLOWED_ROLES = {"auth_role", "admin_role", "teacher_role", "student_role"}

@contextmanager
def with_db_context(role: str, user: dict | None = None):
    if role not in ALLOWED_ROLES:                       # never interpolate unchecked strings
        raise ValueError(f"Unknown role: {role}")
    with pool.connection() as conn:
        with conn.transaction():
            with conn.cursor(row_factory=dict_row) as cur:
                cur.execute(f"SET LOCAL ROLE {role}")   # safe: checked against ALLOWED_ROLES
                if role in ("teacher_role", "student_role"):
                    # set_config values MUST be strings, so always str(...)
                    cur.execute(
                        "SELECT set_config('app.user_id', %s, true),"
                        "       set_config('app.school_id', %s, true),"
                        "       set_config('app.class_id', %s, true)",
                        (str(user["user_id"]), str(user["school_id"]), str(user["class_id"])),
                    )
                yield cur
```

Rules:

* Use it **as a normal `with` block inside the route handler**, never as a FastAPI `Depends(...)` with `yield`. (Depending on the FastAPI version, a yield-dependency can commit after the response is sent, so a commit error would never reach the client.)
* **Return or build the response after the `with` block ends** so the commit has succeeded first.
* Raising `HTTPException` inside the `with` block rolls the transaction back. Use this for "abort the whole operation" cases.
* `main.py` lifespan: `pool.open()` on startup, `pool.close()` on shutdown.
* The role is always a hard-coded string in the route (e.g. `"student_role"`), never taken from the JWT.

### Global DB error handler (`main.py`)

One handler for `psycopg.Error`, using `exc.sqlstate`:

| SQLSTATE | Response |
|---|---|
| `23505` unique violation | `409`, message looked up from `exc.diag.constraint_name` (map below), else "Duplicate value". |
| `23503` foreign key violation | `409` "This record is linked to other data, or its subscription does not exist." |
| `23514` check violation | `422`, message from `exc.diag.constraint_name` (map below), else "Invalid value". |
| `42501` insufficient privilege | **`500`** generic message + `logger.critical(...)`. It means a bug (wrong role / bad column grant), not a client error. |
| `PoolTimeout` (check with `isinstance` first) | `503` "Server busy, try again." |
| anything else | `500` generic message + `logger.exception(...)`. Never leak SQL text to the client. |

Constraint message maps (keep them small):

```python
UNIQUE_MESSAGES = {
    "schools_name_key": "A school with this name already exists.",
    "classes_name_key": "A class with this name already exists.",
    "classes_pkey": "A class with this id already exists.",
    "platform_admins_username_key": "This admin username is taken.",
    "uq_subscriptions_school_class": "This school already has a subscription for that class.",
    "uq_teachers_school_username": "This username is already used by another teacher in this school.",
    "uq_teachers_school_class": "This class already has a teacher.",
    "uq_students_school_reg_num": "A student with this registration number already exists in this school.",
}
CHECK_MESSAGES = {
    "chk_subscriptions_date_range": "end_date must be on or after start_date.",
    "chk_subscriptions_total_seats": "total_seats must be greater than 0.",
    "chk_videos_duration": "Video duration must be greater than 0.",
    "chk_videos_completion_threshold": "Completion threshold must be between 1 and 100.",
}
```

Use Pydantic to catch bad UUIDs, dates and number ranges before they reach the DB.

---

## 7. Security decisions (`security.py`)

### Passwords and JWT

```python
def hash_password(p): return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()
def verify_password(p, h): return bcrypt.checkpw(p.encode(), h.encode())

def create_token(claims: dict) -> str:       # claims must hold only strings/None (convert UUIDs with str())
    payload = {**claims, "exp": datetime.now(timezone.utc) + timedelta(hours=24)}
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")

def require_role(role: str):                 # use as Depends(require_role("student"))
    def dep(creds=Depends(HTTPBearer())):
        try:
            data = jwt.decode(creds.credentials, JWT_SECRET, algorithms=["HS256"],
                              options={"require": ["exp"]})
        except jwt.PyJWTError:
            raise HTTPException(401, "Invalid or expired token")
        if data.get("role") != role:
            raise HTTPException(403, "Not allowed")
        return data
    return dep
```

* Always pass `algorithms=["HS256"]` and require `exp` when decoding.
* Every router uses `require_role(...)` for its own role (a student token must fail on admin routes).
* **JWT claims:** `role`, `user_id`, `school_id`, `class_id` (null for admin), `exp`, plus profile data so the frontend needs no `/me` endpoint: `full_name`, `school_name`, `class_name`, and `username` (admin/teacher) or `registration_number` (student).
* No refresh tokens, no revocation. Tokens simply expire after 24 hours.

### Login rate limiter (in memory)

**Purpose:** stop users from retrying again and again and hammering the server. It is not meant to stop attackers. **Per-account only; no per-IP limit** (many students share one school IP). Applies to all three logins through one helper.

```python
import threading, time
_attempts = {}                    # key -> list of failure timestamps
_lock = threading.Lock()
MAX_FAILS, WINDOW = 5, 300        # 5 failures within 5 minutes

def check_rate_limit(key):        # call BEFORE the login query
    now = time.time()
    with _lock:
        fails = [t for t in _attempts.get(key, []) if now - t < WINDOW]
        if fails: _attempts[key] = fails
        else: _attempts.pop(key, None)
        if len(fails) >= MAX_FAILS:
            raise HTTPException(429, "Too many attempts. Please wait a few minutes and try again.")

def record_failure(key):          # call on any failed login (including unknown user)
    with _lock:
        if len(_attempts) > 5000: _attempts.clear()   # cheap memory guard
        _attempts.setdefault(key, []).append(time.time())

def clear_failures(key):          # call on successful login
    with _lock: _attempts.pop(key, None)
```

Keys: `f"student:{school_id}:{reg_no}"`, `f"teacher:{school_id}:{username}"`, `f"admin:{username}"`.

### Subscription check (login time only, in IST)

Teacher and student logins check:

```sql
(now() AT TIME ZONE 'Asia/Kolkata')::date BETWEEN sub.start_date AND sub.end_date
```

Do not use `CURRENT_DATE` (it follows the DB server timezone). If not active: `403` "Subscription for this class is not active or has expired." The subscription is **not** re-checked during the 24-hour token life (accepted).

---

## 8. Business logic by file

### `routes_auth.py` (`auth_role`)

* **`GET /api/schools`** (public): `SELECT id, name FROM schools ORDER BY name`.
* **Student login**: input `school_id, registration_number, dob`. Strip whitespace on `registration_number`.
  1. `check_rate_limit(key)`.
  2. Query:
     ```sql
     SELECT st.id, st.full_name, st.registration_number, st.school_id, st.class_id,
            sc.name AS school_name, c.name AS class_name,
            (now() AT TIME ZONE 'Asia/Kolkata')::date BETWEEN sub.start_date AND sub.end_date AS active
     FROM students st
     JOIN schools sc ON sc.id = st.school_id
     JOIN classes c ON c.id = st.class_id
     JOIN subscriptions sub ON sub.school_id = st.school_id AND sub.class_id = st.class_id
     WHERE st.school_id = %s AND st.registration_number = %s AND st.dob = %s
     ```
  3. No row: `record_failure`, then **the same generic `401 "Invalid credentials"`** whether the number was unknown or the DOB wrong.
  4. Row but `active` is false: `403` (subscription message above).
  5. Otherwise `clear_failures`, create the JWT.
* **Teacher login**: input `school_id, username, password`. Select the teacher by `(school_id, username)` with school/class names and the same `active` expression; check the password with bcrypt in Python. Same rate limiter, same generic 401, same 403 for inactive subscription.
* **Admin login**: input `username, password`. Select from `platform_admins`; bcrypt check; same rate limiter and generic 401.

### `routes_admin.py` (`admin_role`)

* **Schools / classes / videos:** simple create, list and delete. A class is created with a manual integer `id`. Video `completion_threshold_pct` is validated 1 to 100 in Pydantic. Deleting something that is still in use returns `409` via the error handler.
* **Subscriptions (`PUT`)**: `INSERT ... ON CONFLICT (school_id, class_id) DO UPDATE SET start_date, end_date, total_seats = EXCLUDED...`. No check against the current student count (accepted).
* **Teachers (`PUT`)**: `INSERT ... ON CONFLICT (school_id, class_id) DO UPDATE SET full_name, username, password_hash = EXCLUDED...`. The plain password is hashed with bcrypt first. This creates, replaces or resets the single teacher of a class. The subscription for that school and class must already exist.
* **Students list (`GET /api/admin/students`)**: `school_id` required, `class_id` optional. No pagination. Never return passwords.
* **Bulk CSV upload (`POST /api/admin/students/upload-csv`)**: multipart form with `school_id`, `class_id` and the file.
  * **CSV columns:** `name`, `regno`, `dob` (header names case-insensitive; missing column gives a clear error). School and class come from the form, never from the CSV.
  * Read the file as `utf-8-sig` (Excel BOM). Reject files over 1 MB.
  * Strip whitespace on every value. Keep `regno` as **text** (never convert to int, leading zeros matter).
  * **DOB formats accepted (day first):** `YYYY-MM-DD`, `DD-MM-YYYY`, `DD/MM/YYYY`.
  * **Step 1, validate in Python (collect ALL problems, not just the first):** empty fields, bad date, duplicate `regno` inside the CSV. If any: `422` with `{"detail": "...", "errors": [{"row": 3, "problem": "..."}]}` (row numbers match the CSV line, header = row 1).
  * **Step 2, inside one `admin_role` transaction:**
    1. Lock the subscription:
       `SELECT total_seats FROM subscriptions WHERE school_id = %s AND class_id = %s FOR UPDATE`.
       If no row: `400` "Create a subscription for this class first."
    2. Count existing students in that class. If `existing + csv_rows > total_seats`: `400` stating how many seats remain.
    3. Check for existing registration numbers in the **whole school** (they are unique per school):
       `SELECT registration_number FROM students WHERE school_id = %s AND registration_number = ANY(%s)`.
       If any: `409` listing them.
    4. `cur.executemany("INSERT INTO students (school_id, class_id, registration_number, dob, full_name) VALUES (%s,%s,%s,%s,%s)", rows)`.
  * All or nothing: any failure rolls everything back. The lock also protects against a double-clicked upload.
* **Delete one student:** `DELETE /api/admin/students/{student_id}`.
* **Mass delete (year-end promotion):** `DELETE /api/admin/schools/{school_id}/classes/{class_id}/students` deletes every student in that school class; `video_progress` rows cascade; returns the deleted count. **The frontend shows a confirmation step before calling it; the backend adds nothing extra.**
  * Why it exists: progress rows block changing a student's class, and registration numbers are unique per school.
  * **Admin workflow note: promote the highest class first.** Example: delete class 10 and upload that CSV into class 11, then delete class 9 and upload that CSV into class 10. The target class needs a subscription with enough seats. Keep each roster CSV before deleting, because there is no export.

### `routes_student.py` (`student_role`)

* **`GET /api/student/videos`**
  ```sql
  SELECT v.id, v.title, v.video_url, v.total_duration_seconds, v.completion_threshold_pct,
         COALESCE(vp.status::text, 'not_started') AS status,
         COALESCE(vp.watch_duration_seconds, 0) AS watch_duration_seconds,
         COALESCE(vp.last_position_seconds, 0) AS last_position_seconds
  FROM videos v
  LEFT JOIN video_progress vp ON vp.video_id = v.id AND vp.student_id = %s
  ORDER BY v.title
  ```
  (RLS limits videos to the student's class.)
* **`POST /api/student/videos/{video_id}/progress`**: body `watch_seconds` and `position_seconds` (accept floats, `ge=0`, `le=1000000`; the route converts with `int(...)`, so the frontend can send `video.currentTime` directly).
  * **Decision:** students take tests anyway, so there is **no anti-cheat**. The client's reported seconds are trusted but **clamped to 0..total duration**. The server still computes `status` itself (it is one `CASE`, simpler than accepting a status from the client). Do not accept `status` from the client.
  * One atomic statement. `completed` is permanent. Watch duration never goes backwards (protects against out-of-order requests and rewatching). The completion test uses multiplication to avoid integer division.
  ```sql
  WITH v AS (
      SELECT id, total_duration_seconds, completion_threshold_pct,
             GREATEST(0, LEAST(%(watch)s, total_duration_seconds)) AS watch,
             GREATEST(0, LEAST(%(pos)s,   total_duration_seconds)) AS pos
      FROM videos
      WHERE id = %(video_id)s
  )
  INSERT INTO video_progress
      (school_id, class_id, student_id, video_id, status, watch_duration_seconds, last_position_seconds)
  SELECT current_setting('app.school_id')::uuid,
         current_setting('app.class_id')::int,
         current_setting('app.user_id')::uuid,
         v.id,
         CASE WHEN v.watch * 100 >= v.completion_threshold_pct * v.total_duration_seconds
              THEN 'completed'::progress_status ELSE 'in_progress'::progress_status END,
         v.watch,
         v.pos
  FROM v
  ON CONFLICT (student_id, video_id) DO UPDATE SET
      status = CASE WHEN video_progress.status = 'completed' OR EXCLUDED.status = 'completed'
                    THEN 'completed'::progress_status ELSE 'in_progress'::progress_status END,
      watch_duration_seconds = GREATEST(video_progress.watch_duration_seconds, EXCLUDED.watch_duration_seconds),
      last_position_seconds = EXCLUDED.last_position_seconds,
      updated_at = now()
  RETURNING status, watch_duration_seconds, last_position_seconds;
  ```
  * If `RETURNING` gives no row, the video does not exist for this student's class: return `404`.
  * `DO UPDATE SET` may touch **only** `status, watch_duration_seconds, last_position_seconds, updated_at`. Touching any other column raises `42501`.

### `routes_teacher.py` (`teacher_role`)

* **`GET /api/teacher/dashboard`**: one query, returned as flat rows (the frontend groups them into a matrix):
  ```sql
  SELECT s.id AS student_id, s.registration_number, s.full_name,
         v.id AS video_id, v.title,
         COALESCE(vp.status::text, 'not_started') AS status,
         COALESCE(vp.watch_duration_seconds, 0) AS watch_duration_seconds,
         COALESCE(vp.last_position_seconds, 0) AS last_position_seconds
  FROM students s
  CROSS JOIN videos v
  LEFT JOIN video_progress vp ON vp.student_id = s.id AND vp.video_id = v.id
  ORDER BY s.full_name, v.title
  ```
  RLS limits all three tables to the teacher's school and class. Do not select `dob`.

---

## 9. API endpoint map

| File / role | Endpoints |
|---|---|
| `routes_auth.py` (`auth_role`) | `GET /api/schools`, `POST /api/auth/admin/login`, `POST /api/auth/teacher/login`, `POST /api/auth/student/login` |
| `routes_admin.py` (`admin_role`) | `POST /api/admin/schools`, `DELETE /api/admin/schools/{school_id}` |
| | `GET/POST /api/admin/classes`, `DELETE /api/admin/classes/{class_id}` |
| | `GET /api/admin/subscriptions`, `PUT /api/admin/subscriptions` |
| | `GET/POST /api/admin/videos`, `DELETE /api/admin/videos/{video_id}` |
| | `GET /api/admin/teachers`, `PUT /api/admin/teachers`, `DELETE /api/admin/teachers/{teacher_id}` |
| | `GET /api/admin/students` (needs `school_id`), `DELETE /api/admin/students/{student_id}` |
| | `POST /api/admin/students/upload-csv` |
| | `DELETE /api/admin/schools/{school_id}/classes/{class_id}/students` (mass delete) |
| `routes_student.py` (`student_role`) | `GET /api/student/videos`, `POST /api/student/videos/{video_id}/progress` |
| `routes_teacher.py` (`teacher_role`) | `GET /api/teacher/dashboard` |

**Notes for the frontend:** send the token as `Authorization: Bearer <token>`; send DOB as `YYYY-MM-DD` on student login; read the user's name/school/class from the JWT payload; show a confirmation step before mass delete.

---

## 10. Build roadmap (one phase at a time, wait for confirmation)

* **Phase 0, DB tweaks:** run `0003_tweaks.sql` (Section 5) and update `db_tests.sql` if needed.
* **Phase 1, Foundation** (`db.py`, `main.py`, `requirements.txt`): pool, `with_db_context`, error handler, CORS, `GET /api/schools`.
  *Check:* schools endpoint returns data; a query run without a role switch fails with `42501`.
* **Phase 2, Auth** (`security.py`, `routes_auth.py`): hashing, JWT, `require_role`, rate limiter, three logins, subscription check.
  *First admin:* generate a hash with `python -c "import bcrypt; print(bcrypt.hashpw(b'YOUR_PASSWORD', bcrypt.gensalt()).decode())"` and insert the row into `platform_admins` with psql.
  *Check:* wrong DOB five times gives `429`; expired subscription gives `403`; a student token is rejected on an admin route.
* **Phase 3, Admin** (`routes_admin.py`): all endpoints in Section 8, including CSV upload and mass delete.
  *Check:* CSV with a bad row reports all problems; over-seat upload is rejected with seats remaining; duplicate regno gives `409`.
* **Phase 4, Student** (`routes_student.py`): video list and heartbeat upsert.
  *Check:* completion triggers at the threshold and stays `completed` after a rewatch; sending a smaller duration does not reduce it; unknown video gives `404`.
* **Phase 5, Teacher** (`routes_teacher.py`): dashboard.
  *Check:* teacher sees only their own class; unstarted videos show `not_started`.

---

## 11. Not doing (on purpose, to keep it simple)

ORM, async code, Redis or any external cache, per-IP rate limiting, refresh tokens or token revocation, a `/me` endpoint, anti-cheat on watch time, server-side confirmation for mass delete, pagination, roster export, timing-attack protections, password reset flows, extra architecture layers, extra files beyond the 7 listed.
