# B2B2C EdTech Backend: Complete Summary & Frontend Handoff Guide

## 1. What Has Been Built

The backend is complete, tested across all 5 phases, and locked to a flat 7-file FastAPI + PostgreSQL (`psycopg` v3) architecture with Row-Level Security (RLS).

### Repository Layout
```text
EdTech-main/
├── database/
│   ├── 0002_initial_schema.sql   # 8 tables, roles, column grants, and RLS policies
│   └── 0003_tweaks.sql           # Revokes teacher SELECT on teachers table; sets app_connector password
└── backend/
    ├── requirements.txt          # fastapi, uvicorn, psycopg[binary,pool], bcrypt, PyJWT, python-multipart
    ├── db.py                     # ConnectionPool (app_connector) + with_db_context() role/RLS switcher
    ├── main.py                   # Lifespan pool open/close, CORS, global PsycopgError -> HTTP mapper
    ├── security.py               # bcrypt helpers, 24h HS256 JWT, require_role(), login rate limiter
    ├── routes_auth.py            # Public schools list + Student / Teacher / Admin login endpoints
    ├── routes_admin.py           # Full platform CRUD, teacher/subscription upserts, CSV upload, mass delete
    ├── routes_student.py         # Student class video list + atomic progress heartbeat upsert
    └── routes_teacher.py         # Teacher class progress dashboard (flat student × video matrix rows)
```

### Core Architectural Guarantees
* **Database-Level Isolation (RLS):** Every request checks out a connection from `psycopg_pool.ConnectionPool` as `app_connector` (which has zero table permissions of its own) and runs `SET LOCAL ROLE <role>` inside a transaction. For `student_role` and `teacher_role`, it also sets transaction-local `app.user_id`, `app.school_id`, and `app.class_id`.
* **Stateless Profile Tokens:** JWTs are signed with `HS256`, valid for **24 hours**, and carry all user profile fields (`full_name`, `school_name`, `class_name`, `username` / `registration_number`). **There is no `/me` endpoint**—the frontend reads user identity directly from the decoded JWT payload.
* **IST Subscription Enforcement:** Student and teacher logins check `(now() AT TIME ZONE 'Asia/Kolkata')::date BETWEEN sub.start_date AND sub.end_date`. Expired or future subscriptions fail login with `403`.
* **Per-Account Rate Limiting:** An in-memory sliding window blocks an account for 5 minutes (`429`) after 5 failed login attempts. It keys by account (`student:{school_id}:{reg_no}`, `teacher:{school_id}:{username}`, `admin:{username}`), never by IP, so a school sharing one NAT IP will not lock out a classroom.

---

## 2. Environment & Running the Backend

Required environment variables before starting `uvicorn`:
```bash
export DATABASE_URL="postgresql://app_connector:YOUR_PASSWORD@localhost:5432/edtech"
export JWT_SECRET="at-least-32-random-characters-here"
export CORS_ORIGINS="http://localhost:5173,http://localhost:3000"
```

Run with a **single worker** (required so the in-memory rate limiter state is shared across requests):
```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 1
```

---

## 3. Authentication & JWT Contract for Frontend

### Request Header
Every protected endpoint expects:
```http
Authorization: Bearer <token>
```
* `401 Unauthorized`: Token missing, invalid, or expired (`> 24h`). Frontend should clear stored auth state and redirect to the login page.
* `403 Forbidden`: Valid token, but wrong role for the route (or inactive subscription during login).

### Decoded JWT Payloads by Role

**Admin (`role: "admin"`)**
```json
{
  "role": "admin",
  "user_id": "d290f1ee-6c54-4b01-90e6-d701748f0851",
  "school_id": null,
  "class_id": null,
  "full_name": "Admin",
  "username": "superadmin",
  "exp": 1767225600
}
```

**Teacher (`role: "teacher"`)**
```json
{
  "role": "teacher",
  "user_id": "8f14e45f-ceea-467a-a8f1-4e45fceea123",
  "school_id": "11111111-2222-3333-4444-555555555555",
  "class_id": 10,
  "full_name": "Anita Sharma",
  "school_name": "Delhi Public School",
  "class_name": "Class 10",
  "username": "anita.sharma",
  "exp": 1767225600
}
```

**Student (`role: "student"`)**
```json
{
  "role": "student",
  "user_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "school_id": "11111111-2222-3333-4444-555555555555",
  "class_id": 10,
  "full_name": "Rohan Verma",
  "school_name": "Delhi Public School",
  "class_name": "Class 10",
  "registration_number": "0042",
  "exp": 1767225600
}
```

---

## 4. Complete API Reference

### 4.1 Public & Authentication (`routes_auth.py`)

#### `GET /api/schools` (Public)
Used by the **Student Login**, **Teacher Login**, and **Admin Schools View** to list all schools alphabetically.
* **Response `200`:**
  ```json
  [
    { "id": "11111111-2222-3333-4444-555555555555", "name": "Delhi Public School" }
  ]
  ```

#### `POST /api/auth/student/login`
* **Body:**
  ```json
  {
    "school_id": "11111111-2222-3333-4444-555555555555",
    "registration_number": "0042",
    "dob": "2010-05-14"
  }
  ```
  *(Note: `dob` must be sent as `YYYY-MM-DD`. Leading zeros in `registration_number` are preserved; whitespace is stripped.)*
* **Response `200`:** `{ "token": "<jwt>" }`
* **Errors:** `401` (`"Invalid credentials"`), `403` (`"Subscription for this class is not active or has expired."`), `429` (`"Too many attempts. Please wait a few minutes and try again."`).

#### `POST /api/auth/teacher/login`
* **Body:**
  ```json
  {
    "school_id": "11111111-2222-3333-4444-555555555555",
    "username": "anita.sharma",
    "password": "secretPassword"
  }
  ```
* **Response `200`:** `{ "token": "<jwt>" }`
* **Errors:** `401`, `403`, `429`.

#### `POST /api/auth/admin/login`
* **Body:**
  ```json
  {
    "username": "superadmin",
    "password": "adminPassword"
  }
  ```
* **Response `200`:** `{ "token": "<jwt>" }`
* **Errors:** `401`, `429`.

---

### 4.2 Admin Endpoints (`routes_admin.py` — requires `admin` token)

#### Schools
*(To list schools in the admin panel, call `GET /api/schools`.)*
* **`POST /api/admin/schools`**
  * **Body:** `{ "name": "St. Xavier's High School" }`
  * **Response `200`:** `{ "id": "<uuid>", "name": "St. Xavier's High School", "created_at": "2026-11-02T18:00:00Z" }`
  * **Errors:** `409` (`"A school with this name already exists."`)
* **`DELETE /api/admin/schools/{school_id}`**
  * **Response `200`:** `{ "deleted": true }`
  * **Errors:** `404` (`"School not found."`), `409` (`"This record is linked to other data, or its subscription does not exist."`)

#### Classes
Class `id` is a manual integer (e.g., `9`, `10`, `11`).
* **`GET /api/admin/classes`**
  * **Response `200`:** `[ { "id": 9, "name": "Class 9" }, { "id": 10, "name": "Class 10" } ]`
* **`POST /api/admin/classes`**
  * **Body:** `{ "id": 9, "name": "Class 9" }`
  * **Response `200`:** `{ "id": 9, "name": "Class 9" }`
  * **Errors:** `409` (`"A class with this id already exists."` or `"A class with this name already exists."`)
* **`DELETE /api/admin/classes/{class_id}`**
  * **Response `200`:** `{ "deleted": true }`
  * **Errors:** `404`, `409` (if subscriptions or videos reference this class).

#### Subscriptions
One subscription per `(school_id, class_id)`. `PUT` creates or updates in place.
* **`GET /api/admin/subscriptions`**
  * **Response `200`:**
    ```json
    [
      {
        "id": "<uuid>",
        "school_id": "<uuid>",
        "class_id": 10,
        "start_date": "2026-04-01",
        "end_date": "2027-03-31",
        "total_seats": 120
      }
    ]
    ```
* **`PUT /api/admin/subscriptions`**
  * **Body:**
    ```json
    {
      "school_id": "<uuid>",
      "class_id": 10,
      "start_date": "2026-04-01",
      "end_date": "2027-03-31",
      "total_seats": 120
    }
    ```
  * **Response `200`:** Returns the created/updated subscription object.
  * **Errors:** `422` (`end_date < start_date` or `total_seats <= 0`), `409` (if `school_id` or `class_id` does not exist).

#### Videos
Videos belong to a `class_id` (shared across all schools subscribed to that class).
* **`GET /api/admin/videos`**
  * **Response `200`:**
    ```json
    [
      {
        "id": "<uuid>",
        "class_id": 10,
        "title": "Introduction to Trigonometry",
        "video_url": "https://cdn.example.com/trig.mp4",
        "total_duration_seconds": 600,
        "completion_threshold_pct": 85.0
      }
    ]
    ```
* **`POST /api/admin/videos`**
  * **Body:**
    ```json
    {
      "class_id": 10,
      "title": "Introduction to Trigonometry",
      "video_url": "https://cdn.example.com/trig.mp4",
      "total_duration_seconds": 600,
      "completion_threshold_pct": 85
    }
    ```
    *(`total_duration_seconds > 0`; `completion_threshold_pct` between `1` and `100`.)*
  * **Response `200`:** Returns the created video object.
* **`DELETE /api/admin/videos/{video_id}`**
  * **Response `200`:** `{ "deleted": true }` *(Cascades and deletes any `video_progress` rows for this video).*

#### Teachers
Each `(school_id, class_id)` has **at most one teacher** and **requires an existing subscription** for that `(school_id, class_id)` first. `PUT` creates, replaces, or resets the password for that class's teacher.
* **`GET /api/admin/teachers`**
  * **Response `200`:**
    ```json
    [
      {
        "id": "<uuid>",
        "school_id": "<uuid>",
        "class_id": 10,
        "full_name": "Anita Sharma",
        "username": "anita.sharma"
      }
    ]
    ```
* **`PUT /api/admin/teachers`**
  * **Body:**
    ```json
    {
      "school_id": "<uuid>",
      "class_id": 10,
      "full_name": "Anita Sharma",
      "username": "anita.sharma",
      "password": "newPassword123"
    }
    ```
    *(`password` max length is 72 characters.)*
  * **Response `200`:** `{ "id": "<uuid>", "school_id": "<uuid>", "class_id": 10, "full_name": "Anita Sharma", "username": "anita.sharma" }`
  * **Errors:** `409` (`"This username is already used by another teacher in this school."` or `"This record is linked to other data, or its subscription does not exist."`).
* **`DELETE /api/admin/teachers/{teacher_id}`**
  * **Response `200`:** `{ "deleted": true }`

#### Students (List, Bulk CSV Upload, Single Delete, Mass Delete)
* **`GET /api/admin/students?school_id=<uuid>&class_id=<int optional>`**
  * `school_id` query param is **required**; `class_id` is optional.
  * **Response `200`:**
    ```json
    [
      {
        "id": "<uuid>",
        "school_id": "<uuid>",
        "class_id": 10,
        "registration_number": "0042",
        "dob": "2010-05-14",
        "full_name": "Rohan Verma"
      }
    ]
    ```
* **`POST /api/admin/students/upload-csv`** (`multipart/form-data`)
  * **Form Fields:**
    * `school_id`: `<uuid>`
    * `class_id`: `<int>`
    * `file`: CSV file (`<= 1 MB`, UTF-8 or UTF-8 with BOM)
  * **CSV Format:** Must include headers `name`, `regno`, `dob` (case-insensitive, any column order). Accepted `dob` formats: `YYYY-MM-DD`, `DD-MM-YYYY`, or `DD/MM/YYYY`.
  * **Response `200`:** `{ "inserted": 45 }`
  * **Error Responses (All-or-Nothing):**
    * `400`: Empty file, missing required headers, file > 1 MB, no subscription for `(school_id, class_id)`, or seat limit exceeded (`"Seat limit exceeded. 12 seat(s) remaining."`).
    * `422`: Row-level validation errors (collects **all** problematic rows in one pass, where header = row 1, first data row = row 2):
      ```json
      {
        "detail": "CSV validation failed.",
        "errors": [
          { "row": 3, "problem": "Missing name, regno, or dob." },
          { "row": 7, "problem": "Duplicate regno '0042' in CSV." },
          { "row": 9, "problem": "Invalid dob '2010/31/02'. Use YYYY-MM-DD, DD-MM-YYYY, or DD/MM/YYYY." }
        ]
      }
      ```
    * `409`: Registration number already exists anywhere in the same school (`"Registration numbers already exist in this school: 0042, 0043"`).
* **`DELETE /api/admin/students/{student_id}`**
  * **Response `200`:** `{ "deleted": true }` *(Cascades and deletes the student's `video_progress`).*
* **`DELETE /api/admin/schools/{school_id}/classes/{class_id}/students`** (Mass Delete / Year-End Promotion)
  * Deletes all students in that `(school_id, class_id)` and cascades their `video_progress`.
  * **Response `200`:** `{ "deleted": 45 }`

---

### 4.3 Student Endpoints (`routes_student.py` — requires `student` token)

#### `GET /api/student/videos`
Returns all videos assigned to the student's class merged with the student's own progress (ordered by `title`).
* **Response `200`:**
  ```json
  [
    {
      "id": "<uuid>",
      "title": "Introduction to Trigonometry",
      "video_url": "https://cdn.example.com/trig.mp4",
      "total_duration_seconds": 600,
      "completion_threshold_pct": 85.0,
      "status": "not_started",
      "watch_duration_seconds": 0,
      "last_position_seconds": 0
    }
  ]
  ```
  *(`status` is one of `"not_started"`, `"in_progress"`, or `"completed"`.)*

#### `POST /api/student/videos/{video_id}/progress`
Heartbeat endpoint called periodically while playing and on pause/ended.
* **Body:**
  ```json
  {
    "watch_seconds": 512.4,
    "position_seconds": 510.8
  }
  ```
  *(Accepts floats `0..1_000_000`, so the frontend can pass cumulative watched seconds and `videoElement.currentTime` directly. The backend truncates to `int` and clamps both values to `0..total_duration_seconds`.)*
* **Server Rules:**
  * Once `status` reaches `"completed"` (`watch * 100 >= completion_threshold_pct * total_duration_seconds`), it stays `"completed"` permanently even if rewatched.
  * `watch_duration_seconds` never decreases (`GREATEST(old, new)`).
  * `last_position_seconds` always reflects the latest clamped `position_seconds` so the player can resume where the student left off.
* **Response `200`:**
  ```json
  {
    "status": "completed",
    "watch_duration_seconds": 512,
    "last_position_seconds": 510
  }
  ```
* **Errors:** `404` (`"Video not found."` if `video_id` does not exist or belongs to another class).

---

### 4.4 Teacher Endpoints (`routes_teacher.py` — requires `teacher` token)

#### `GET /api/teacher/dashboard`
Returns the flat cartesian product (`students CROSS JOIN videos LEFT JOIN video_progress`) for the teacher's `(school_id, class_id)`, ordered by `full_name, title`. Student `dob` is never included.
* **Response `200`:**
  ```json
  [
    {
      "student_id": "<uuid>",
      "registration_number": "0042",
      "full_name": "Rohan Verma",
      "video_id": "<uuid>",
      "title": "Introduction to Trigonometry",
      "status": "in_progress",
      "watch_duration_seconds": 240,
      "last_position_seconds": 240
    }
  ]
  ```

---

## 5. Key Frontend Implementation Notes

1. **Handling Empty Teacher Dashboards:** Because `GET /api/teacher/dashboard` uses a `CROSS JOIN` between `students` and `videos`, if a class has **0 students** or **0 videos**, the endpoint returns `[]`. The teacher UI should display a clear empty-state message ("No students or videos assigned to this class yet").
2. **Pivoting the Teacher Matrix:** Group the flat dashboard rows on the client:
   * Unique students by `student_id` (`full_name`, `registration_number`) as table rows.
   * Unique videos by `video_id` (`title`) as table columns (or vice versa).
   * Map `(student_id, video_id)` to `{ status, watch_duration_seconds, last_position_seconds }`.
3. **Video Player Progress Heartbeat:**
   * On load, seek the `<video>` element to `last_position_seconds` (if `< total_duration_seconds`).
   * Track `watch_duration_seconds` by starting from the initial `watch_duration_seconds` returned by `GET /api/student/videos` and incrementing it as playback progresses (or passing `max(initial_watch_seconds, currentTime)`), sending a `POST /api/student/videos/{video_id}/progress` every ~10–15 seconds, on `pause`, and on `ended`.
4. **Admin Mass Delete Confirmation & Workflow:**
   * The backend has no extra confirmation step on `DELETE /api/admin/schools/{school_id}/classes/{class_id}/students`. The frontend **must** show a confirmation modal before firing the request.
   * Display a note in the Admin UI reminding admins to **promote the highest class first** (e.g., delete Class 10 and upload their CSV into Class 11 before deleting Class 9 and uploading into Class 10), because `registration_number` is unique across the entire school.