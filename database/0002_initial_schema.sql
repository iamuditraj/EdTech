BEGIN;

-- ============================================================================
-- 1. TYPES & TABLES (8 Tables Total)
-- ============================================================================
CREATE TYPE progress_status AS ENUM ('in_progress', 'completed');

CREATE TABLE schools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE classes (
    id INT PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE
);

CREATE TABLE platform_admins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL
);

CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
    class_id INT NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    total_seats INT NOT NULL,
    CONSTRAINT uq_subscriptions_school_class UNIQUE (school_id, class_id),
    CONSTRAINT chk_subscriptions_date_range CHECK (end_date >= start_date),
    CONSTRAINT chk_subscriptions_total_seats CHECK (total_seats > 0)
);

CREATE TABLE videos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_id INT NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
    title VARCHAR(255) NOT NULL,
    video_url TEXT NOT NULL,
    total_duration_seconds INT NOT NULL,
    completion_threshold_pct NUMERIC(5, 2) NOT NULL,
    CONSTRAINT uq_videos_id_class UNIQUE (id, class_id),
    CONSTRAINT chk_videos_duration CHECK (total_duration_seconds > 0),
    CONSTRAINT chk_videos_completion_threshold CHECK (completion_threshold_pct BETWEEN 1 AND 100)
);

CREATE TABLE teachers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL,
    class_id INT NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    username VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    CONSTRAINT fk_teachers_subscription FOREIGN KEY (school_id, class_id)
        REFERENCES subscriptions (school_id, class_id) ON DELETE RESTRICT,
    CONSTRAINT uq_teachers_school_username UNIQUE (school_id, username),
    CONSTRAINT uq_teachers_school_class UNIQUE (school_id, class_id)
);

CREATE TABLE students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL,
    class_id INT NOT NULL,
    registration_number VARCHAR(255) NOT NULL,
    dob DATE NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    CONSTRAINT fk_students_subscription FOREIGN KEY (school_id, class_id)
        REFERENCES subscriptions (school_id, class_id) ON DELETE RESTRICT,
    CONSTRAINT uq_students_school_reg_num UNIQUE (school_id, registration_number),
    CONSTRAINT uq_students_id_school_class UNIQUE (id, school_id, class_id)
);

CREATE TABLE video_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL,
    class_id INT NOT NULL,
    student_id UUID NOT NULL,
    video_id UUID NOT NULL,
    status progress_status NOT NULL DEFAULT 'in_progress',
    watch_duration_seconds INT NOT NULL DEFAULT 0,
    last_position_seconds INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_video_progress_student_video UNIQUE (student_id, video_id),
    CONSTRAINT fk_video_progress_student FOREIGN KEY (student_id, school_id, class_id)
        REFERENCES students (id, school_id, class_id) ON DELETE CASCADE,
    CONSTRAINT fk_video_progress_video FOREIGN KEY (video_id, class_id)
        REFERENCES videos (id, class_id) ON DELETE CASCADE,
    CONSTRAINT chk_video_progress_watch_duration CHECK (watch_duration_seconds >= 0),
    CONSTRAINT chk_video_progress_last_position CHECK (last_position_seconds >= 0)
);

CREATE INDEX idx_videos_class_id ON videos(class_id);
CREATE INDEX idx_students_school_class ON students(school_id, class_id);
CREATE INDEX idx_video_progress_video_id ON video_progress(video_id);
CREATE INDEX idx_video_progress_school_class ON video_progress(school_id, class_id);

-- ============================================================================
-- 2. CREATE ROLES
-- ============================================================================
CREATE ROLE auth_role NOLOGIN BYPASSRLS;
CREATE ROLE admin_role NOLOGIN BYPASSRLS;
CREATE ROLE teacher_role NOLOGIN;
CREATE ROLE student_role NOLOGIN;

CREATE ROLE app_connector WITH LOGIN PASSWORD 'CHANGE_ME_STRONG_PASSWORD' NOINHERIT;

-- ============================================================================
-- 3. TABLE PRIVILEGES (GRANTS)
-- ============================================================================
-- Base schema access for all roles
GRANT USAGE ON SCHEMA public TO auth_role, admin_role, teacher_role, student_role, app_connector;

-- Enable role switching for the connection pool
GRANT auth_role, admin_role, teacher_role, student_role TO app_connector;

-- auth_role: Strictly read-only for login validation
GRANT SELECT ON platform_admins, teachers, students, subscriptions, schools, classes TO auth_role;

-- admin_role: Full CRUD access bypassing RLS
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO admin_role;

-- teacher_role: Read-only access to necessary tables
GRANT SELECT ON schools, classes, videos, teachers, students, video_progress TO teacher_role;

-- student_role: Read-only access to necessary tables + progress updates
GRANT SELECT ON schools, classes, videos, students, video_progress TO student_role;
GRANT INSERT ON video_progress TO student_role;
GRANT UPDATE (status, watch_duration_seconds, last_position_seconds, updated_at) ON video_progress TO student_role;

-- ============================================================================
-- 4. ENABLE & FORCE ROW LEVEL SECURITY
-- ============================================================================
ALTER TABLE videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE videos FORCE ROW LEVEL SECURITY;

ALTER TABLE teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE teachers FORCE ROW LEVEL SECURITY;

ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE students FORCE ROW LEVEL SECURITY;

ALTER TABLE video_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_progress FORCE ROW LEVEL SECURITY;

-- ============================================================================
-- 5. RLS POLICIES (With NULLIF connection pool fix applied)
-- ============================================================================

CREATE POLICY teacher_self_read ON teachers
    FOR SELECT TO teacher_role
    USING (
        id = NULLIF(current_setting('app.user_id', true), '')::uuid 
        AND school_id = NULLIF(current_setting('app.school_id', true), '')::uuid 
        AND class_id = NULLIF(current_setting('app.class_id', true), '')::int
    );

CREATE POLICY student_self_read ON students
    FOR SELECT TO student_role
    USING (
        id = NULLIF(current_setting('app.user_id', true), '')::uuid 
        AND school_id = NULLIF(current_setting('app.school_id', true), '')::uuid 
        AND class_id = NULLIF(current_setting('app.class_id', true), '')::int
    );

CREATE POLICY teacher_read_class_roster ON students
    FOR SELECT TO teacher_role
    USING (
        school_id = NULLIF(current_setting('app.school_id', true), '')::uuid 
        AND class_id = NULLIF(current_setting('app.class_id', true), '')::int
    );

CREATE POLICY videos_class_read ON videos
    FOR SELECT TO teacher_role, student_role
    USING (
        class_id = NULLIF(current_setting('app.class_id', true), '')::int
    );

CREATE POLICY teacher_read_class_progress ON video_progress
    FOR SELECT TO teacher_role
    USING (
        school_id = NULLIF(current_setting('app.school_id', true), '')::uuid 
        AND class_id = NULLIF(current_setting('app.class_id', true), '')::int
    );

CREATE POLICY student_manage_own_progress ON video_progress
    FOR ALL TO student_role
    USING (
        student_id = NULLIF(current_setting('app.user_id', true), '')::uuid 
        AND school_id = NULLIF(current_setting('app.school_id', true), '')::uuid 
        AND class_id = NULLIF(current_setting('app.class_id', true), '')::int
    )
    WITH CHECK (
        student_id = NULLIF(current_setting('app.user_id', true), '')::uuid 
        AND school_id = NULLIF(current_setting('app.school_id', true), '')::uuid 
        AND class_id = NULLIF(current_setting('app.class_id', true), '')::int
    );

COMMIT;

BEGIN;

-- Add notes + mcqs to videos
ALTER TABLE videos
  ADD COLUMN notes_url TEXT,
  ADD COLUMN mcqs JSONB NOT NULL DEFAULT '[]';

-- Add quiz results + student answers to video_progress
ALTER TABLE video_progress
  ADD COLUMN quiz_score INT,
  ADD COLUMN quiz_total INT,
  ADD COLUMN quiz_answers JSONB;
  -- NULL = not attempted; quiz_answers stores [0, 2, 1, ...] (selected indices)

-- Let students write quiz results to their own progress rows
GRANT UPDATE (quiz_score, quiz_total, quiz_answers) ON video_progress TO student_role;

COMMIT;