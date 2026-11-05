BEGIN;

ALTER TABLE videos
    ADD COLUMN IF NOT EXISTS notes_url TEXT,
    ADD COLUMN IF NOT EXISTS mcqs JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE video_progress
    ADD COLUMN IF NOT EXISTS quiz_score INT,
    ADD COLUMN IF NOT EXISTS quiz_total INT,
    ADD COLUMN IF NOT EXISTS quiz_answers JSONB;

GRANT UPDATE (quiz_score, quiz_total, quiz_answers) ON video_progress TO student_role;

COMMIT;

