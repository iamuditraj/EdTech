import json
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from db import with_db_context
from security import require_role

router = APIRouter(prefix="/api/student")
student_auth = Depends(require_role("student"))


class ProgressUpdate(BaseModel):
    watch_seconds: float = Field(ge=0, le=1_000_000)
    position_seconds: float = Field(ge=0, le=1_000_000)


class QuizSubmit(BaseModel):
    answers: list[int]


@router.get("/videos")
def get_videos(user: dict = student_auth):
    with with_db_context("student_role", user) as cur:
        rows = cur.execute("""
            SELECT v.id, v.title, v.video_url, v.total_duration_seconds, v.completion_threshold_pct,
                   v.notes_url,
                   COALESCE(v.mcqs, '[]'::jsonb) AS mcqs,
                   COALESCE(vp.status::text, 'not_started') AS status,
                   COALESCE(vp.watch_duration_seconds, 0) AS watch_duration_seconds,
                   COALESCE(vp.last_position_seconds, 0) AS last_position_seconds,
                   vp.quiz_score,
                   vp.quiz_total,
                   vp.quiz_answers
            FROM videos v
            LEFT JOIN video_progress vp ON vp.video_id = v.id AND vp.student_id = %s
            ORDER BY v.title
        """, (user["user_id"],)).fetchall()

    for r in rows:
        raw_mcqs = r.get("mcqs") or []
        is_attempted = r.get("quiz_score") is not None
        student_answers = r.get("quiz_answers") or []
        safe_mcqs = []
        for i, q in enumerate(raw_mcqs):
            item = {
                "question": q.get("question"),
                "options": q.get("options", []),
            }
            if is_attempted:
                item["correct_index"] = q.get("correct_index")
                item["selected_index"] = student_answers[i] if i < len(student_answers) else None
            safe_mcqs.append(item)
        r["mcqs"] = safe_mcqs

    return rows


@router.post("/videos/{video_id}/quiz")
def submit_quiz(video_id: UUID, req: QuizSubmit, user: dict = student_auth):
    with with_db_context("student_role", user) as cur:
        v = cur.execute(
            "SELECT COALESCE(mcqs, '[]'::jsonb) AS mcqs FROM videos WHERE id = %s",
            (str(video_id),)
        ).fetchone()
        if not v:
            raise HTTPException(404, "Video not found.")

        mcqs = v["mcqs"]
        if not mcqs:
            raise HTTPException(400, "This video has no quiz.")

        if len(req.answers) != len(mcqs):
            raise HTTPException(400, f"Expected {len(mcqs)} answers, got {len(req.answers)}.")

        score = sum(1 for ans, q in zip(req.answers, mcqs) if ans == q.get("correct_index"))
        total = len(mcqs)
        answers_json = json.dumps(req.answers)

        row = cur.execute("""
            INSERT INTO video_progress
                (school_id, class_id, student_id, video_id, status, watch_duration_seconds, last_position_seconds, quiz_score, quiz_total, quiz_answers)
            VALUES (
                current_setting('app.school_id')::uuid,
                current_setting('app.class_id')::int,
                current_setting('app.user_id')::uuid,
                %(video_id)s,
                'in_progress'::progress_status,
                0,
                0,
                %(score)s,
                %(total)s,
                %(answers)s::jsonb
            )
            ON CONFLICT (student_id, video_id) DO UPDATE SET
                quiz_score = EXCLUDED.quiz_score,
                quiz_total = EXCLUDED.quiz_total,
                quiz_answers = EXCLUDED.quiz_answers,
                updated_at = now()
            RETURNING quiz_score, quiz_total, quiz_answers
        """, {
            "video_id": str(video_id),
            "score": score,
            "total": total,
            "answers": answers_json,
        }).fetchone()

    return row


@router.post("/videos/{video_id}/progress")
def update_progress(video_id: UUID, req: ProgressUpdate, user: dict = student_auth):
    with with_db_context("student_role", user) as cur:
        # DO UPDATE only touches the 4 columns granted to student_role, otherwise Postgres raises 42501
        row = cur.execute("""
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
            RETURNING status, watch_duration_seconds, last_position_seconds
        """, {
            "video_id": str(video_id),
            "watch": int(req.watch_seconds),
            "pos": int(req.position_seconds),
        }).fetchone()
        if not row:
            raise HTTPException(404, "Video not found.")
    return row