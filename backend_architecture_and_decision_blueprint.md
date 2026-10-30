# B2B2C EdTech Platform: Backend Architecture, Logic & Implementation Blueprint

## 1. Purpose of This Document
This document serves as the **complete architectural memory and decision specification** for building the B2B2C EdTech backend. The PostgreSQL database (`0002_initial_schema.sql`) is already finalized, tested, and deployed with strict Row-Level Security (RLS), role privileges, and composite foreign keys.

When assisting with backend implementation in a new chat session, follow every architectural decision, SQL rule, and phased roadmap step defined below. Keep the code **simple, flat, and easy to understand**, avoiding unnecessary abstractions.

---

## 2. Locked-In Tech Stack & Architecture Decisions

1. **Language & Framework:** Python + **FastAPI** + **Pydantic** (for request/response validation).
2. **Database Driver (No ORM):** **`psycopg` (v3)** with `psycopg_pool` using **raw parameterized SQL queries**.
   * *Why no ORM:* The database requires switching execution roles (`SET LOCAL ROLE`) and setting transaction-local session variables (`set_config`) on every transaction. Additionally, `student_role` has strict column-level `UPDATE` grants on `video_progress` (updating only 4 specific columns). Full ORMs obscure transaction boundaries and often include unpermitted columns in `UPDATE` statements, triggering PostgreSQL permission errors (`42501`).
3. **Authentication & Passwords:**
   * Password hashing via `bcrypt` (or `pwdlib` / `argon2`).
   * Stateless **24-hour JWTs** via `PyJWT`.
4. **Rate Limiting:**
   * Simple **in-memory Python dictionary** with time-window expiration (no Redis or external cache infrastructure needed for this single-instance deployment).
5. **Flat, Role-Based Project Structure (7 Files Total):**
   Do not use multi-layered "Clean Architecture" (`controllers/`, `services/`, `repositories/`). Group the entire backend into 7 flat files:
   * `main.py` — FastAPI app setup, CORS, connection pool lifespan, and the global PostgreSQL error translator.
   * `db.py` — `psycopg` connection pool connecting as `app_connector` and the `with_db_context` transaction wrapper.
   * `security.py` — Password hashing, 24-hour JWT creation/decoding, FastAPI auth dependencies, and the in-memory login rate limiter.
   * `routes_auth.py` — Public school dropdown endpoint and login endpoints for Admin, Teacher, and Student (runs under `auth_role`).
   * `routes_admin.py` — Platform Admin CRUD, subscription upsert, teacher assignment, bulk CSV student upload, and mass class roster delete (runs under `admin_role`).
   * `routes_student.py` — Student video catalog and atomic heartbeat progress upsert (runs under `student_role`).
   * `routes_teacher.py` — Read-only teacher cohort progress matrix (runs under `teacher_role`).

---

## 3. Database Schema & Role Quick-Reference

### The 5 Database Roles
1. **`app_connector` (`LOGIN`, `NOINHERIT`):** Base connection pool user. Has **zero permissions** on any table. If an endpoint forgets to switch roles inside a transaction, queries fail immediately with `42501` (`permission denied`). Can switch into the 4 roles below.
2. **`auth_role` (`NOLOGIN`, `BYPASSRLS`):** Strictly `SELECT` access on `platform_admins`, `teachers`, `students`, `subscriptions`, `schools`, and `classes`. Cannot read `videos` or `video_progress`, and cannot write anything.
3. **`admin_role` (`NOLOGIN`, `BYPASSRLS`):** Full CRUD privileges on all 8 tables.
4. **`teacher_role` (`NOLOGIN`, RLS Enforced):** Strictly `SELECT` access on `schools`, `classes`, `videos`, `teachers`, `students`, and `video_progress` scoped by RLS to `app.school_id` and `app.class_id`.
5. **`student_role` (`NOLOGIN`, RLS Enforced):** `SELECT` access on `schools`, `classes`, `videos`, `students`, and `video_progress` (own rows/class). `INSERT` on `video_progress` and column-restricted `UPDATE (status, watch_duration_seconds, last_position_seconds, updated_at)` on `video_progress`.

### The 8 Tables & Critical Constraints
1. **`schools`** (`id` UUID PK, `name` UNIQUE, `created_at`) — No RLS.
2. **`classes`** (`id` INT PK manually assigned e.g. `9`, `10`, `name` UNIQUE) — No RLS.
3. **`platform_admins`** (`id` UUID PK, `username` UNIQUE, `password_hash`) — No RLS; blocked from teachers/students via table privileges.
4. **`subscriptions`** (`id` UUID PK, `school_id` FK Restrict, `class_id` FK Restrict, `start_date`, `end_date`, `total_seats`) — Unique on `(school_id, class_id)`. Check constraints: `end_date >= start_date`, `total_seats > 0`. In-place update strategy.
5. **`videos`** (`id` UUID PK, `class_id` FK Restrict, `title`, `video_url`, `total_duration_seconds > 0`, `completion_threshold_pct BETWEEN 1 AND 100`) — Forced RLS (`class_id` matches `app.class_id`). Unique on `(id, class_id)`.
6. **`teachers`** (`id` UUID PK, `school_id`, `class_id`, `full_name`, `username`, `password_hash`) — Forced RLS. Composite FK `(school_id, class_id)` references `subscriptions(school_id, class_id)` (`ON DELETE RESTRICT`). Unique on `(school_id, username)` and **`(school_id, class_id)`** (strictly 1 teacher per school class).
7. **`students`** (`id` UUID PK, `school_id`, `class_id`, `registration_number`, `dob` DATE, `full_name`) — Forced RLS. Composite FK `(school_id, class_id)` references `subscriptions(school_id, class_id)` (`ON DELETE RESTRICT`). Unique on **`(school_id, registration_number)`** and `(id, school_id, class_id)`.
8. **`video_progress`** (`id` UUID PK, `school_id`, `class_id`, `student_id`, `video_id`, `status` enum `'in_progress'|'completed'`, `watch_duration_seconds >= 0`, `last_position_seconds >= 0`, `updated_at`) — Forced RLS. Unique on `(student_id, video_id)`. Composite FKs to `students(id, school_id, class_id)` and `videos(id, class_id)` with **`ON DELETE CASCADE`**.

---

## 4. Core Engine Mechanics (`db.py` & `main.py`)

### A. The Mandatory Transaction Wrapper (`with_db_context`)
Every database operation must run through a single context manager in `db.py`:
1. Borrow a connection from the `app_connector` pool and enter a transaction block (`with conn.transaction():`).
2. **Role Whitelist Check:** Verify the target role against a hardcoded Python set: `ALLOWED_ROLES = {"auth_role", "admin_role", "teacher_role", "student_role"}`. Never interpolate raw user/JWT strings into `SET LOCAL ROLE`.
3. Switch the role locally for the transaction:
   * `cur.execute(f"SET LOCAL ROLE {role}")` (safe because `role` is verified against `ALLOWED_ROLES`).
4. **Set RLS Context (for `teacher_role` and `student_role`):**
   * Because PostgreSQL `SET` does not accept bind parameters, always use `set_config(setting_name, new_value, is_local=true)` with parameterized queries:
   ```sql
   SELECT
       set_config('app.user_id', %s, true),
       set_config('app.school_id', %s, true),
       set_config('app.class_id', %s, true);
   ```
5. Yield the cursor (`cur`) to the route handler to execute its parameterized SQL queries.
6. When the `with` block exits, `psycopg` automatically commits the transaction (or rolls back on exception), and `SET LOCAL` / `set_config(..., true)` settings are wiped clean before the connection returns to the pool.

### B. Global Database Error Translator (`main.py`)
Instead of cluttering endpoints with repetitive `try/except` blocks, register one global FastAPI exception handler for `psycopg.Error` that inspects `exc.sqlstate`:
* **`23505` (`UniqueViolation`):** Return `409 Conflict` with a clean detail message (inspect `exc.diag.constraint_name` to tell the user if it was a duplicate school name, class, registration number, or teacher assignment).
* **`23503` (`ForeignKeyViolation`):** Return `400 Bad Request` or `409 Conflict` (e.g., trying to delete a school/class/subscription that still has dependent records, or trying to add a teacher/student to an unsubscribed class).
* **`23514` (`CheckViolation`):** Return `422 Unprocessable Entity` (e.g., `end_date < start_date`, `total_seats <= 0`, or invalid video duration/threshold).
* **`42501` (`InsufficientPrivilege`):** Log a loud critical error on the server and return `403 Forbidden` (indicates a bug in role switching or an attempt to violate RLS/column grants).

---

## 5. Finalized Business Logic & Edge-Case Decisions

### 1. Authentication, Rate Limiting & Subscription Cutoff (`routes_auth.py`)
* **Public School List (`GET /api/schools`):** Runs under `auth_role` so the login page dropdown can list all schools prior to authentication.
* **In-Memory Rate Limiter on Student Login:**
  * Students log in using `(school_id, registration_number, dob)`. Even though dates of birth may be known within a school, a successful login issues a JWT containing student and school PII.
  * Track failed attempts in memory per client IP and per `(school_id, registration_number)` (e.g., block for 5 minutes after 5 failed attempts within a 5-minute window).
  * Always return the exact same generic `401 Unauthorized` error (`"Invalid credentials"`) whether the registration number was not found or the DOB was wrong.
* **Subscription Active-Date Gatekeeper (Login-Time Check):**
  * During both **Teacher** and **Student** login (under `auth_role`), join or query `subscriptions` for `(school_id, class_id)` and verify:
    ```sql
    CURRENT_DATE BETWEEN s.start_date AND s.end_date
    ```
  * If no active subscription exists or today is outside `[start_date, end_date]`, reject login with `403 Forbidden` (`"Subscription for this class is not active or has expired"`).
  * *Accepted Trade-off:* Subscription dates are checked only at login.
* **24-Hour Stateless JWT Payload:**
  * Embed both security claims and UI profile data so the frontend never needs a `/me` endpoint:
    * Security claims: `role`, `user_id`, `school_id`, `class_id`, `exp` (24 hours).
    * Profile claims: `full_name`, `school_name`, `class_name`, and `username` (teacher/admin) or `registration_number` (student).

### 2. Platform Admin Workflows (`routes_admin.py`)
* **In-Place Subscription Upsert (`PUT /api/admin/subscriptions`):**
  * Use `INSERT INTO subscriptions (school_id, class_id, start_date, end_date, total_seats) VALUES (%s, %s, %s, %s, %s) ON CONFLICT (school_id, class_id) DO UPDATE SET start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date, total_seats = EXCLUDED.total_seats`.
* **Single-Teacher-Per-Grade Assignment (`PUT /api/admin/teachers`):**
  * Because `uq_teachers_school_class` allows only 1 teacher per `(school_id, class_id)`, use an upsert on `(school_id, class_id)` so the admin can easily create or replace the class teacher or reset their password.
* **Bulk Student CSV Upload (`POST /api/admin/students/upload-csv`):**
  * **All-or-Nothing Rollback:** Pre-validate all CSV rows in Python memory first (checking required fields, date format `YYYY-MM-DD`, and duplicate `registration_number` values inside the CSV itself). If any row fails either pre-validation or database insertion, roll back the entire upload and report the offending row.
  * **Concurrency Lock (`FOR UPDATE`) & Seat-Cap Enforcement:** Even with a single admin, accidental double-clicks can fire two parallel upload requests. Inside the `admin_role` transaction:
    1. Lock the subscription row first:
       ```sql
       SELECT total_seats FROM subscriptions
       WHERE school_id = %s AND class_id = %s
       FOR UPDATE;
       ```
    2. Count existing students in that class:
       ```sql
       SELECT COUNT(*) FROM students
       WHERE school_id = %s AND class_id = %s;
       ```
    3. Verify $\text{existing\_count} + \text{csv\_count} \le \text{total\_seats}$. If it exceeds `total_seats`, abort and return `400 Bad Request` telling the admin how many seats remain.
    4. Insert the students.
* **Year-End Student Promotion via Mass Delete (`DELETE /api/admin/schools/{school_id}/classes/{class_id}/students`):**
  * *Why this exists:* `video_progress` has a composite FK to `students(id, school_id, class_id)`, which blocks updating a student's `class_id` once they have watched a video. Furthermore, `uq_students_school_reg_num` enforces unique registration numbers across the entire `school_id`.
  * *Workflow:* At the end of an academic year, the admin uses a "Mass Delete Class Roster" button calling `DELETE /api/admin/schools/{school_id}/classes/{class_id}/students`. This deletes all students in that `(school_id, class_id)` in one transaction (automatically cascading and wiping their `video_progress` rows), freeing up their registration numbers so the admin can immediately upload the promoted CSV into the next class.

### 3. Student Video Progress & Heartbeat Logic (`routes_student.py`)
* **Trust Client Timer with Server-Side Clamping:**
  * We do not enforce complex heartbeat delta rate-checks against students skipping ahead; we keep the logic simple.
  * However, the server **never** trusts a client-sent `status`, and always clamps both `watch_duration_seconds` and `last_position_seconds` so they sit between `0` and `videos.total_duration_seconds`.
* **Atomic Single-Query Upsert (`POST /api/student/videos/{video_id}/progress`):**
  * Do not fetch the row in Python, calculate math, and run separate `INSERT`/`UPDATE` statements. Run one atomic SQL statement under `student_role` that:
    1. Fetches `total_duration_seconds` and `completion_threshold_pct` from `videos` (RLS automatically ensures the video belongs to the student's `class_id`).
    2. Clamps incoming durations using `GREATEST(0, LEAST(%s, v.total_duration_seconds))`.
    3. Computes whether the clamped duration meets the threshold:
       $$\left(\frac{\text{clamped\_watch\_duration}}{\text{total\_duration\_seconds}}\right) \times 100 \ge \text{completion\_threshold\_pct}$$
    4. **Enforces Monotonic Completion:** In the `ON CONFLICT (student_id, video_id) DO UPDATE` clause, if `video_progress.status = 'completed'`, keep it `'completed'` forever even if the student re-watches from `0`.
    5. **Respects Column-Level Grants:** The `DO UPDATE SET` clause must **only** touch `status`, `watch_duration_seconds`, `last_position_seconds`, and `updated_at = now()`. Touching `school_id`, `class_id`, `student_id`, or `video_id` in `DO UPDATE` will trigger a `42501` privilege error.

### 4. Teacher Cohort Matrix (`routes_teacher.py`)
* **Matrix Query (`GET /api/teacher/dashboard`):**
  * Because unstarted videos have no rows in `video_progress`, execute a `students CROSS JOIN videos LEFT JOIN video_progress` query under `teacher_role` (RLS automatically restricts `students`, `videos`, and `video_progress` to the teacher's `school_id` and `class_id`).
  * Use `COALESCE(vp.status::text, 'not_started')` for status, and `COALESCE(..., 0)` for `watch_duration_seconds` and `last_position_seconds`.
  * **Security Rule:** Never run `SELECT * FROM teachers` in any teacher endpoint, as `teacher_role` has table-level `SELECT` access to its own row including `password_hash`.

---

## 6. Complete API Endpoint Map

### `routes_auth.py` (`auth_role`)
* `GET /api/schools` — List all schools (`id`, `name`) for login dropdown.
* `POST /api/auth/admin/login` — Admin login (`username`, `password`) $\rightarrow$ 24h JWT.
* `POST /api/auth/teacher/login` — Teacher login (`school_id`, `username`, `password`) + subscription date check $\rightarrow$ 24h JWT.
* `POST /api/auth/student/login` — Rate-limited Student login (`school_id`, `registration_number`, `dob`) + subscription date check $\rightarrow$ 24h JWT.

### `routes_admin.py` (`admin_role`)
* `POST /api/admin/schools` & `DELETE /api/admin/schools/{school_id}` — Create or delete a school.
* `GET /api/admin/classes`, `POST /api/admin/classes` & `DELETE /api/admin/classes/{class_id}` — List, create (with manual integer ID), or delete a class.
* `GET /api/admin/subscriptions` & `PUT /api/admin/subscriptions` — List subscriptions or create/update a `(school_id, class_id)` subscription in-place.
* `GET /api/admin/videos`, `POST /api/admin/videos` & `DELETE /api/admin/videos/{video_id}` — Manage videos and completion thresholds per class.
* `GET /api/admin/teachers`, `PUT /api/admin/teachers` & `DELETE /api/admin/teachers/{teacher_id}` — List teachers, assign/replace the teacher for a `(school_id, class_id)` (including password reset), or delete a teacher.
* `GET /api/admin/students` — List students (filterable by `school_id` and `class_id`).
* `POST /api/admin/students/upload-csv` — Bulk CSV student upload with `FOR UPDATE` subscription lock, seat-cap check, and all-or-nothing rollback.
* `DELETE /api/admin/students/{student_id}` — Delete an individual student.
* `DELETE /api/admin/schools/{school_id}/classes/{class_id}/students` — **Mass delete** all students (and cascaded progress) in a specific school class for year-end promotion.

### `routes_student.py` (`student_role`)
* `GET /api/student/videos` — List all videos for the student's class with current `status`, `watch_duration_seconds`, and `last_position_seconds`.
* `POST /api/student/videos/{video_id}/progress` — Atomic heartbeat upsert clamping duration/position, computing completion, and enforcing monotonic `'completed'` status.

### `routes_teacher.py` (`teacher_role`)
* `GET /api/teacher/dashboard` — Return the full class roster, video list, and student-video progress matrix (`not_started` / `in_progress` / `completed`).

---

## 7. Step-by-Step Build Roadmap

When building the code, proceed one phase at a time and wait for confirmation before moving to the next phase:

* **Phase 1: Foundation & Database Engine (`db.py`, `main.py`, `requirements.txt`)**
  * Set up the `psycopg` connection pool using `app_connector`, write the `with_db_context` transaction wrapper, register the global PostgreSQL error handler (`23505`, `23503`, `23514`, `42501`), and wire up `GET /api/schools` to test the database connection.
* **Phase 2: Security & Authentication (`security.py`, `routes_auth.py`)**
  * Build password hashing, 24-hour JWT generation/verification dependencies, the in-memory student login rate limiter, subscription active-date checks, and the 3 login endpoints.
* **Phase 3: Platform Admin Operations (`routes_admin.py`)**
  * Implement CRUD for schools, classes, subscriptions (in-place upsert), videos, teachers (upsert), bulk CSV student upload (with `FOR UPDATE` lock and seat check), single student delete, and the mass class roster delete endpoint.
* **Phase 4: Student Experience (`routes_student.py`)**
  * Implement `GET /api/student/videos` and the atomic `POST /api/student/videos/{video_id}/progress` upsert query.
* **Phase 5: Teacher Dashboard (`routes_teacher.py`)**
  * Implement `GET /api/teacher/dashboard` using the `CROSS JOIN` / `LEFT JOIN` reporting matrix query.