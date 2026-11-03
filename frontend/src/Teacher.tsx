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
        </>
    );
}

