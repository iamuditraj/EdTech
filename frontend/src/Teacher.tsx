import { useState } from "react";
import { useFetch, ErrorBanner, Header } from "./ui";
import type { TeacherDashboardRow, VideoStatus, McqItem } from "./types";

// --- Status badge (same styles as Student) ---

const BADGE: Record<VideoStatus, string> = {
    not_started: "bg-slate-100 text-slate-700",
    in_progress: "bg-blue-100 text-blue-700",
    completed: "bg-green-100 text-green-700",
};

const BADGE_LABEL: Record<VideoStatus, string> = {
    not_started: "Not Started",
    in_progress: "In Progress",
    completed: "Completed",
};

function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
}

function QuizReviewModal({ mcqs, answers, score, total, onClose }: {
    mcqs: McqItem[]; answers: number[]; score: number; total: number; onClose: () => void;
}) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
            <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[80vh] overflow-y-auto p-5 space-y-3" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-slate-900">Quiz Review — {score}/{total}</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg">✕</button>
                </div>
                {mcqs.map((m, i) => {
                    const selected = answers[i];
                    return (
                        <div key={i} className="rounded border p-3 space-y-1">
                            <p className="text-sm font-medium text-slate-900">Q{i + 1}. {m.question}</p>
                            {m.options.map((opt, oi) => {
                                const isCorrect = oi === m.correct_index;
                                const isPicked = oi === selected;
                                let cls = "text-sm px-2 py-0.5 rounded ";
                                if (isCorrect) cls += "bg-green-100 text-green-800 font-medium";
                                else if (isPicked) cls += "bg-red-100 text-red-800";
                                else cls += "text-slate-600";
                                return <div key={oi} className={cls}>{isCorrect && "✅ "}{isPicked && !isCorrect && "❌ "}{opt}</div>;
                            })}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export function TeacherDashboard() {
    const { data: rows, loading, error } = useFetch<TeacherDashboardRow[]>("/api/teacher/dashboard");
    const [reviewCell, setReviewCell] = useState<TeacherDashboardRow | null>(null);

    // Pivot: unique students as rows, unique videos as columns
    const students: { id: string; name: string; regno: string }[] = [];
    const videos: { id: string; title: string }[] = [];
    const cellMap = new Map<string, TeacherDashboardRow>();

    if (rows) {
        const seenStudents = new Set<string>();
        const seenVideos = new Set<string>();
        for (const r of rows) {
            if (!seenStudents.has(r.student_id)) {
                seenStudents.add(r.student_id);
                students.push({ id: r.student_id, name: r.full_name, regno: r.registration_number });
            }
            if (!seenVideos.has(r.video_id)) {
                seenVideos.add(r.video_id);
                videos.push({ id: r.video_id, title: r.title });
            }
            cellMap.set(`${r.student_id}:${r.video_id}`, r);
        }
    }

    const isEmpty = rows && rows.length === 0;

    return (
        <>
            <Header />
            <main className="p-4">
                <h1 className="text-lg font-semibold text-slate-900">Class Progress</h1>

                {loading && <p className="mt-4 text-sm text-slate-500">Loading…</p>}
                <ErrorBanner message={error} />

                {isEmpty && (
                    <p className="mt-4 text-sm text-slate-500">No students or videos assigned to this class yet.</p>
                )}

                {rows && rows.length > 0 && (
                    <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
                        <table className="min-w-full text-sm">
                            <thead className="bg-slate-50">
                                <tr>
                                    <th scope="col" className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left font-medium text-slate-700">
                                        Student
                                    </th>
                                    {videos.map((v) => (
                                        <th key={v.id} scope="col" className="px-3 py-2 text-left font-medium text-slate-700 whitespace-nowrap">
                                            {v.title}
                                        </th>
                                    ))}
                                    <th scope="col" className="px-3 py-2 text-left font-medium text-slate-700 whitespace-nowrap">
                                        Completed
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {students.map((s) => {
                                    let completed = 0;
                                    for (const v of videos) {
                                        const cell = cellMap.get(`${s.id}:${v.id}`);
                                        if (cell?.status === "completed") completed++;
                                    }
                                    return (
                                        <tr key={s.id}>
                                            <td className="sticky left-0 z-10 bg-white px-3 py-2 whitespace-nowrap">
                                                <div className="font-medium text-slate-900">{s.name}</div>
                                                <div className="text-xs text-slate-500">{s.regno}</div>
                                            </td>
                                            {videos.map((v) => {
                                                const cell = cellMap.get(`${s.id}:${v.id}`);
                                                if (!cell) return <td key={v.id} className="px-3 py-2 text-slate-400">—</td>;
                                                return (
                                                    <td key={v.id} className="px-3 py-2 whitespace-nowrap">
                                                        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[cell.status]}`}>
                                                            {BADGE_LABEL[cell.status]}
                                                        </span>
                                                        <div className="mt-0.5 text-xs text-slate-500">
                                                            {formatTime(cell.watch_duration_seconds)}
                                                        </div>
                                                        {cell.quiz_score !== null && (
                                                            <button
                                                                className="mt-0.5 text-xs font-medium text-indigo-600 hover:underline"
                                                                onClick={() => setReviewCell(cell)}
                                                            >
                                                                Quiz: {cell.quiz_score}/{cell.quiz_total}
                                                            </button>
                                                        )}
                                                    </td>
                                                );
                                            })}
                                            <td className="px-3 py-2 text-sm text-slate-700 whitespace-nowrap">
                                                {completed} / {videos.length}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </main>

            {reviewCell && reviewCell.quiz_answers && (
                <QuizReviewModal
                    mcqs={reviewCell.mcqs}
                    answers={reviewCell.quiz_answers}
                    score={reviewCell.quiz_score!}
                    total={reviewCell.quiz_total!}
                    onClose={() => setReviewCell(null)}
                />
            )}
        </>
    );
}

