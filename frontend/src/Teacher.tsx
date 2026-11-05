import { useState } from "react";
import { useFetch, ErrorBanner, Header } from "./ui";
import type { TeacherDashboardRow, VideoStatus } from "./types";

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

export function TeacherDashboard() {
    const { data: rows, loading, error } = useFetch<TeacherDashboardRow[]>("/api/teacher/dashboard");
    const [reviewCell, setReviewCell] = useState<{ studentName: string; videoTitle: string; cell: TeacherDashboardRow } | null>(null);

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
                                                        {cell.quiz_score !== null && cell.quiz_score !== undefined ? (
                                                            <button
                                                                type="button"
                                                                onClick={() => setReviewCell({ studentName: s.name, videoTitle: v.title, cell })}
                                                                className="mt-1 block text-xs font-semibold text-purple-700 hover:underline"
                                                                title="Click to view question-by-question student answers"
                                                            >
                                                                Quiz: {cell.quiz_score}/{cell.quiz_total} ↗
                                                            </button>
                                                        ) : cell.mcqs && cell.mcqs.length > 0 ? (
                                                            <div className="mt-1 text-[11px] text-slate-400">
                                                                Quiz: —
                                                            </div>
                                                        ) : null}
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

                {/* Question-by-question Quiz Review Modal for Teacher */}
                {reviewCell && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                        <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
                            <div className="flex items-start justify-between border-b pb-3">
                                <div>
                                    <h2 className="text-base font-bold text-slate-900">Quiz Answers Review</h2>
                                    <p className="text-xs text-slate-600 mt-0.5">
                                        Student: <span className="font-semibold text-slate-800">{reviewCell.studentName}</span> · Video: <span className="font-semibold text-slate-800">{reviewCell.videoTitle}</span>
                                    </p>
                                    <p className="mt-1 text-xs font-semibold text-purple-700">
                                        Score: {reviewCell.cell.quiz_score} / {reviewCell.cell.quiz_total} ({Math.round(((reviewCell.cell.quiz_score ?? 0) / (reviewCell.cell.quiz_total || 1)) * 100)}%)
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setReviewCell(null)}
                                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 text-sm"
                                >
                                    ✕
                                </button>
                            </div>

                            <div className="mt-4 space-y-4">
                                {reviewCell.cell.mcqs && reviewCell.cell.mcqs.length > 0 ? (
                                    reviewCell.cell.mcqs.map((q, qIdx) => {
                                        const studentAns = reviewCell.cell.quiz_answers?.[qIdx];
                                        const isCorrect = studentAns === q.correct_index;

                                        return (
                                            <div
                                                key={qIdx}
                                                className={`rounded border p-3 ${
                                                    isCorrect ? "border-green-300 bg-green-50/40" : "border-red-300 bg-red-50/40"
                                                }`}
                                            >
                                                <div className="flex items-center justify-between">
                                                    <span className="text-xs font-semibold text-slate-600">Question {qIdx + 1}</span>
                                                    <span
                                                        className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                                                            isCorrect ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
                                                        }`}
                                                    >
                                                        {isCorrect ? "✓ Correct" : "✗ Wrong"}
                                                    </span>
                                                </div>
                                                <p className="mt-1 text-sm font-medium text-slate-900">{q.question}</p>

                                                <div className="mt-2 space-y-1.5 text-xs">
                                                    {q.options.map((opt, optIdx) => {
                                                        const isStudentPick = studentAns === optIdx;
                                                        const isKey = q.correct_index === optIdx;

                                                        let style = "border-slate-200 bg-white text-slate-600";
                                                        let badge = null;

                                                        if (isKey && isStudentPick) {
                                                            style = "border-green-500 bg-green-100 font-semibold text-green-900";
                                                            badge = "✓ Student Answer (Correct)";
                                                        } else if (isKey) {
                                                            style = "border-green-500 bg-green-50 font-semibold text-green-900";
                                                            badge = "✓ Correct Answer";
                                                        } else if (isStudentPick) {
                                                            style = "border-red-500 bg-red-100 font-semibold text-red-900";
                                                            badge = "✗ Student Answer (Wrong)";
                                                        }

                                                        return (
                                                            <div
                                                                key={optIdx}
                                                                className={`flex items-center justify-between rounded border p-2 ${style}`}
                                                            >
                                                                <span>{opt}</span>
                                                                {badge && (
                                                                    <span className="ml-2 text-[11px] font-medium opacity-90">
                                                                        {badge}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        );
                                    })
                                ) : (
                                    <p className="text-xs text-slate-500">No question details available.</p>
                                )}
                            </div>

                            <div className="mt-6 flex justify-end border-t pt-3">
                                <button
                                    type="button"
                                    onClick={() => setReviewCell(null)}
                                    className="rounded bg-slate-800 px-4 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </main>
        </>
    );
}

