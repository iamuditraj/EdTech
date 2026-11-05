export type Role = "admin" | "teacher" | "student";

export interface AdminJwt {
    role: "admin";
    user_id: string;
    school_id: null;
    class_id: null;
    full_name: string;
    username: string;
    exp: number;
}

export interface TeacherJwt {
    role: "teacher";
    user_id: string;
    school_id: string;
    class_id: number;
    full_name: string;
    school_name: string;
    class_name: string;
    username: string;
    exp: number;
}

export interface StudentJwt {
    role: "student";
    user_id: string;
    school_id: string;
    class_id: number;
    full_name: string;
    school_name: string;
    class_name: string;
    registration_number: string;
    exp: number;
}

export type JwtPayload = AdminJwt | TeacherJwt | StudentJwt;

export interface LoginResponse {
    token: string;
}

export interface School {
    id: string;
    name: string;
    created_at?: string;
}

export interface ClassItem {
    id: number;
    name: string;
}

export interface Subscription {
    id: string;
    school_id: string;
    class_id: number;
    start_date: string;
    end_date: string;
    total_seats: number;
}

export interface McqItem {
    question: string;
    options: string[];
    correct_index?: number;
    selected_index?: number | null;
}

export interface AdminVideo {
    id: string;
    class_id: number;
    title: string;
    video_url: string;
    total_duration_seconds: number;
    completion_threshold_pct: number;
    notes_url?: string | null;
    mcqs?: McqItem[];
}

export interface Teacher {
    id: string;
    school_id: string;
    class_id: number;
    full_name: string;
    username: string;
}

export interface AdminStudent {
    id: string;
    school_id: string;
    class_id: number;
    registration_number: string;
    dob: string;
    full_name: string;
}

export interface CsvRowError {
    row: number;
    problem: string;
}

export interface CsvUploadResponse {
    inserted: number;
}

export interface DeleteResponse {
    deleted: boolean;
}

export interface MassDeleteResponse {
    deleted: number;
}

export type VideoStatus = "not_started" | "in_progress" | "completed";

export interface StudentVideo {
    id: string;
    title: string;
    video_url: string;
    total_duration_seconds: number;
    completion_threshold_pct: number;
    status: VideoStatus;
    watch_duration_seconds: number;
    last_position_seconds: number;
    notes_url?: string | null;
    mcqs: McqItem[];
    quiz_score?: number | null;
    quiz_total?: number | null;
    quiz_answers?: number[] | null;
}

export interface ProgressResponse {
    status: VideoStatus;
    watch_duration_seconds: number;
    last_position_seconds: number;
}

export interface QuizSubmitResponse {
    quiz_score: number;
    quiz_total: number;
    quiz_answers: number[];
}

export interface TeacherDashboardRow {
    student_id: string;
    registration_number: string;
    full_name: string;
    video_id: string;
    title: string;
    status: VideoStatus;
    watch_duration_seconds: number;
    last_position_seconds: number;
    quiz_score?: number | null;
    quiz_total?: number | null;
    quiz_answers?: number[] | null;
    mcqs?: McqItem[];
}