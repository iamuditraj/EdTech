from uuid import uuid4
from fastapi.testclient import TestClient

from db import with_db_context
from main import app
from security import create_token

C1, C2 = 991, 992  # temporary test class IDs

with TestClient(app) as client:
    school_id = None
    try:
        # Setup: 1 school, 2 classes, 1 student & 2 videos in C1, 1 student & 1 video in C2
        with with_db_context("admin_role") as cur:
            cur.execute("INSERT INTO classes (id, name) VALUES (%s, 'Test991'), (%s, 'Test992')", (C1, C2))
            school_id = cur.execute("INSERT INTO schools (name) VALUES ('TestSchool_P5') RETURNING id").fetchone()["id"]
            cur.execute(
                "INSERT INTO subscriptions (school_id, class_id, start_date, end_date, total_seats) "
                "VALUES (%s, %s, '2025-01-01', '2027-01-01', 10), (%s, %s, '2025-01-01', '2027-01-01', 10)",
                (school_id, C1, school_id, C2),
            )
            s1 = cur.execute(
                "INSERT INTO students (school_id, class_id, registration_number, dob, full_name) "
                "VALUES (%s, %s, 'R1', '2010-01-01', 'Alice') RETURNING id", (school_id, C1)
            ).fetchone()["id"]
            cur.execute(
                "INSERT INTO students (school_id, class_id, registration_number, dob, full_name) "
                "VALUES (%s, %s, 'R2', '2010-01-01', 'Bob_OtherClass')", (school_id, C2)
            )
            v1 = cur.execute(
                "INSERT INTO videos (class_id, title, video_url, total_duration_seconds, completion_threshold_pct) "
                "VALUES (%s, 'Vid_A_Started', 'http://x', 100, 80) RETURNING id", (C1,)
            ).fetchone()["id"]
            v2 = cur.execute(
                "INSERT INTO videos (class_id, title, video_url, total_duration_seconds, completion_threshold_pct) "
                "VALUES (%s, 'Vid_B_Unstarted', 'http://x', 100, 80) RETURNING id", (C1,)
            ).fetchone()["id"]
            cur.execute(
                "INSERT INTO videos (class_id, title, video_url, total_duration_seconds, completion_threshold_pct) "
                "VALUES (%s, 'Vid_C_OtherClass', 'http://x', 100, 80)", (C2,)
            )
            cur.execute(
                "INSERT INTO video_progress (school_id, class_id, student_id, video_id, status, watch_duration_seconds, last_position_seconds) "
                "VALUES (%s, %s, %s, %s, 'in_progress', 45, 30)", (school_id, C1, s1, v1)
            )

        teacher_token = create_token({"role": "teacher", "user_id": str(uuid4()), "school_id": str(school_id), "class_id": C1})
        student_token = create_token({"role": "student", "user_id": str(s1), "school_id": str(school_id), "class_id": C1})

        # 1. Student token rejected on teacher route
        r403 = client.get("/api/teacher/dashboard", headers={"Authorization": f"Bearer {student_token}"})
        assert r403.status_code == 403, r403.text

        # 2. Teacher in C1 sees ONLY C1 student x C1 videos (2 rows), never C2
        r200 = client.get("/api/teacher/dashboard", headers={"Authorization": f"Bearer {teacher_token}"})
        assert r200.status_code == 200, r200.text
        rows = r200.json()
        assert len(rows) == 2, f"Expected 2 rows for C1, got {len(rows)}: {rows}"
        assert all("dob" not in row and row["full_name"] == "Alice" for row in rows)

        # 3. Started vs unstarted values match
        by_title = {row["title"]: row for row in rows}
        assert by_title["Vid_A_Started"]["status"] == "in_progress"
        assert by_title["Vid_A_Started"]["watch_duration_seconds"] == 45
        assert by_title["Vid_B_Unstarted"]["status"] == "not_started"
        assert by_title["Vid_B_Unstarted"]["watch_duration_seconds"] == 0
        print("Phase 5 self-check passed.")

    finally:
        with with_db_context("admin_role") as cur:
            if school_id:
                cur.execute("DELETE FROM students WHERE school_id = %s", (school_id,))
                cur.execute("DELETE FROM subscriptions WHERE school_id = %s", (school_id,))
                cur.execute("DELETE FROM schools WHERE id = %s", (school_id,))
            cur.execute("DELETE FROM videos WHERE class_id IN (%s, %s)", (C1, C2))
            cur.execute("DELETE FROM classes WHERE id IN (%s, %s)", (C1, C2))