from fastapi import APIRouter, Depends

from db import with_db_context
from security import require_role

router = APIRouter(prefix="/api/teacher")
teacher_auth = Depends(require_role("teacher"))


@router.get("/dashboard")
def get_dashboard(user: dict = teacher_auth):
    # shortcut: flat cartesian product in one query, switch to pagination only if class size * videos exceeds a few thousand rows
    with with_db_context("teacher_role", user) as cur:
        rows = cur.execute("""
            SELECT s.id AS student_id, s.registration_number, s.full_name,
                   v.id AS video_id, v.title,
                   COALESCE(vp.status::text, 'not_started') AS status,
                   COALESCE(vp.watch_duration_seconds, 0) AS watch_duration_seconds,
                   COALESCE(vp.last_position_seconds, 0) AS last_position_seconds,
                   vp.quiz_score,
                   vp.quiz_total,
                   vp.quiz_answers,
                   COALESCE(v.mcqs, '[]'::jsonb) AS mcqs
            FROM students s
            CROSS JOIN videos v
            LEFT JOIN video_progress vp ON vp.student_id = s.id AND vp.video_id = v.id
            ORDER BY s.full_name, v.title
        """).fetchall()
    return rows