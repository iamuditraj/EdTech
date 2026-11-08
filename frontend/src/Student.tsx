import { useRef, useEffect, useState, useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "./api";
import { useFetch, ErrorBanner, Header } from "./ui";
import type { StudentVideo, ProgressResponse, VideoStatus, McqItem, QuizSubmitResponse } from "./types";

// shortcut: regex handles watch, youtu.be, embed, and shorts links; switch to URL parser if playlist params are needed
function getYouTubeId(url: string): string | null {
    const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/))([a-zA-Z0-9_-]{11})/);
    return m ? m[1] : null;
}

console.assert(getYouTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ") === "dQw4w9WgXcQ", "watch url");
console.assert(getYouTubeId("https://youtu.be/dQw4w9WgXcQ?si=123") === "dQw4w9WgXcQ", "short url");

// --- Status badge ---

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

function StatusBadge({ status }: { status: VideoStatus }) {
    return (
        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[status]}`}>
            {BADGE_LABEL[status]}
        </span>
    );
}

// --- Video list page ---

export function StudentVideoList() {
    const { data: videos, loading, error } = useFetch<StudentVideo[]>("/api/student/videos");

    return (
        <>
            <Header />
            <main className="mx-auto max-w-2xl p-4">
                <h1 className="text-lg font-semibold text-slate-900">My Videos</h1>

                {loading && <p className="mt-4 text-sm text-slate-500">Loading...</p>}
                <ErrorBanner message={error} />

                {videos && videos.length === 0 && (
                    <p className="mt-4 text-sm text-slate-500">No videos have been added for your class yet.</p>
                )}

                <div className="mt-4 grid gap-4 grid-cols-1 sm:grid-cols-2">
                    {videos?.map((v) => {
                        const pct = v.total_duration_seconds > 0
                            ? Math.min(100, Math.round((v.watch_duration_seconds / v.total_duration_seconds) * 100))
                            : 0;
                        const ytId = getYouTubeId(v.video_url);
                        return (
                            <Link
                                key={v.id}
                                to={`/student/videos/${v.id}`}
                                className="block rounded-lg border border-slate-200 bg-white p-4 shadow-sm hover:border-blue-300"
                            >
                                {ytId && (
                                    <img
                                        src={`https://img.youtube.com/vi/${ytId}/mqdefault.jpg`}
                                        alt={v.title}
                                        className="mb-3 aspect-video w-full rounded bg-slate-100 object-cover"
                                    />
                                )}
                                <div className="flex items-start justify-between gap-2">
                                    <h2 className="text-sm font-medium text-slate-900">{v.title}</h2>
                                    <StatusBadge status={v.status} />
                                </div>
                                {/* Progress bar */}
                                <div className="mt-3 h-2 w-full rounded-full bg-slate-200">
                                    <div
                                        className="h-2 rounded-full bg-blue-600 transition-all"
                                        style={{ width: `${pct}%` }}
                                    />
                                </div>
                                <p className="mt-1 text-xs text-slate-500">
                                    {pct}% watched - Complete at {v.completion_threshold_pct}%
                                </p>
                                {v.quiz_score !== null && (
                                    <p className="mt-1 text-xs font-medium text-indigo-600">Quiz: {v.quiz_score}/{v.quiz_total}</p>
                                )}
                            </Link>
                        );
                    })}
                </div>
            </main>
        </>
    );
}

// --- Player page ---

export function StudentVideoPlayer() {
    const { id } = useParams<{ id: string }>();
    const { data: videos, loading, error, reload } = useFetch<StudentVideo[]>("/api/student/videos");

    const video = videos?.find((v) => v.id === id) ?? null;
    const notFound = videos && !video;

    return (
        <>
            <Header />
            <main className="mx-auto max-w-3xl p-4">
                {loading && <p className="text-sm text-slate-500">Loading...</p>}
                <ErrorBanner message={error} />

                {notFound && (
                    <div className="text-sm text-slate-700">
                        <p>Video not found.</p>
                        <Link to="/student" className="text-blue-600 hover:underline">Back to videos</Link>
                    </div>
                )}

                {video && <Player video={video} onQuizSubmit={reload} />}
            </main>
        </>
    );
}

// --- Quiz Review (shared between student and after-submit) ---

function QuizReview({ mcqs }: { mcqs: McqItem[] }) {
    return (
        <div className="space-y-3">
            {mcqs.map((m, i) => {
                const correct = m.correct_index;
                const selected = m.selected_index;
                return (
                    <div key={i} className="rounded border p-3 bg-white">
                        <p className="text-sm font-medium text-slate-900">Q{i + 1}. {m.question}</p>
                        <div className="mt-2 space-y-1">
                            {m.options.map((opt, oi) => {
                                const isCorrect = oi === correct;
                                const isSelected = oi === selected;
                                let cls = "text-sm px-2 py-1 rounded ";
                                if (isCorrect) cls += "bg-green-100 text-green-800 font-medium";
                                else if (isSelected && !isCorrect) cls += "bg-red-100 text-red-800";
                                else cls += "text-slate-600";
                                return (
                                    <div key={oi} className={cls}>
                                        {isCorrect && "[Correct] "}{isSelected && !isCorrect && "[Selected] "}{opt}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

// --- Player with temporary YouTube iframe + page-open heartbeat ---

function Player({ video, onQuizSubmit }: { video: StudentVideo; onQuizSubmit: () => void }) {
    const watchRef = useRef(video.watch_duration_seconds);
    const [watched, setWatched] = useState(video.watch_duration_seconds);
    const [status, setStatus] = useState<VideoStatus>(video.status);
    const [showQuiz, setShowQuiz] = useState(false);
    const [quizScore, setQuizScore] = useState<number | null>(video.quiz_score);
    const [quizTotal, setQuizTotal] = useState<number | null>(video.quiz_total);
    const [answers, setAnswers] = useState<(number | null)[]>(() => new Array(video.mcqs.length).fill(null));
    const [quizError, setQuizError] = useState<string | null>(null);
    const [quizBusy, setQuizBusy] = useState(false);

    const attempted = quizScore !== null;
    const hasMcqs = video.mcqs.length > 0;
    const ytId = getYouTubeId(video.video_url);

    // Send heartbeat — silent on failure (401 still triggers logout via api.ts)
    const sendHeartbeat = useCallback(() => {
        api<ProgressResponse>(`/api/student/videos/${video.id}/progress`, {
            method: "POST",
            body: {
                watch_seconds: watchRef.current,
                position_seconds: watchRef.current,
            },
        })
            .then((res) => {
                setStatus(res.status);
                watchRef.current = Math.max(watchRef.current, res.watch_duration_seconds);
                setWatched(watchRef.current);
            })
            .catch(() => { /* silent — next tick retries */ });
    }, [video.id]);

    // shortcut: 1s visible page timer instead of YouTube IFrame API; revert to <video> events after demo
    useEffect(() => {
        const thresholdSeconds = Math.ceil((video.completion_threshold_pct / 100) * video.total_duration_seconds);

        const id = window.setInterval(() => {
            if (document.visibilityState !== "visible") return;
            if (watchRef.current < video.total_duration_seconds) {
                watchRef.current += 1;
                setWatched(watchRef.current);
            }
            if (watchRef.current === thresholdSeconds || watchRef.current % 15 === 0) {
                sendHeartbeat();
            }
        }, 1_000);

        return () => {
            window.clearInterval(id);
            sendHeartbeat();
        };
    }, [video.total_duration_seconds, video.completion_threshold_pct, sendHeartbeat]);

    async function submitQuiz() {
        if (answers.some(a => a === null)) {
            setQuizError("Please answer all questions.");
            return;
        }
        setQuizBusy(true);
        setQuizError(null);
        try {
            const res = await api<QuizSubmitResponse>(`/api/student/videos/${video.id}/quiz`, {
                method: "POST",
                body: { answers },
            });
            setQuizScore(res.quiz_score);
            setQuizTotal(res.quiz_total);
            setStatus((prev) => (prev === "not_started" ? "in_progress" : prev));
            onQuizSubmit(); // reload video list to get correct_index in mcqs for review
        } catch (err: any) {
            setQuizError(err.message ?? "Failed to submit quiz");
        } finally {
            setQuizBusy(false);
        }
    }

    const pct = video.total_duration_seconds > 0
        ? Math.min(100, Math.round((watched / video.total_duration_seconds) * 100))
        : 0;

    return (
        <div>
            <Link to="/student" className="text-sm text-blue-600 hover:underline">Back to videos</Link>
            <h1 className="mt-2 text-lg font-semibold text-slate-900">{video.title}</h1>
            <div className="mt-1 flex items-center gap-2">
                <StatusBadge status={status} />
                <span className="text-xs text-slate-500">{pct}% watched - Complete at {video.completion_threshold_pct}%</span>
            </div>

            {ytId ? (
                <iframe
                    src={`https://www.youtube.com/embed/${ytId}?rel=0`}
                    title={video.title}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                    allowFullScreen
                    className="mt-4 aspect-video w-full rounded bg-black"
                />
            ) : (
                <p className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                    Invalid YouTube URL: {video.video_url}
                </p>
            )}

            {/* Action bar */}
            <div className="mt-3 flex flex-wrap items-center gap-3">
                {video.notes_url && (
                    <a href={video.notes_url} target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-200">
                        Download Notes
                    </a>
                )}
                {hasMcqs && !attempted && (
                    <button onClick={() => setShowQuiz(prev => !prev)}
                        className="inline-flex items-center gap-1 rounded bg-indigo-100 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-200">
                        {showQuiz ? "Hide Test" : `Take Test (${video.mcqs.length} Qs)`}
                    </button>
                )}
                {attempted && (
                    <>
                        <span className="inline-flex items-center gap-1 rounded bg-green-100 px-3 py-1.5 text-sm font-medium text-green-700">
                            Quiz: {quizScore}/{quizTotal}
                        </span>
                        <button onClick={() => setShowQuiz(prev => !prev)}
                            className="text-sm text-indigo-600 hover:underline">
                            {showQuiz ? "Hide Review" : "View Answers"}
                        </button>
                    </>
                )}
            </div>

            {/* Quiz section */}
            {showQuiz && hasMcqs && (
                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-4">
                    {attempted ? (
                        <>
                            <h2 className="text-sm font-semibold text-slate-900">Quiz Review - {quizScore}/{quizTotal}</h2>
                            <QuizReview mcqs={video.mcqs} />
                        </>
                    ) : (
                        <>
                            <h2 className="text-sm font-semibold text-slate-900">Quiz</h2>
                            {quizError && <ErrorBanner message={quizError} />}
                            {video.mcqs.map((m, qi) => (
                                <div key={qi} className="rounded border bg-white p-3 space-y-2">
                                    <p className="text-sm font-medium text-slate-900">Q{qi + 1}. {m.question}</p>
                                    <div className="space-y-1">
                                        {m.options.map((opt, oi) => (
                                            <label key={oi} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                                                <input
                                                    type="radio" name={`quiz-${qi}`}
                                                    checked={answers[qi] === oi}
                                                    onChange={() => setAnswers(prev => { const a = [...prev]; a[qi] = oi; return a; })}
                                                />
                                                {opt}
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            ))}
                            <button onClick={submitQuiz} disabled={quizBusy}
                                className="bg-indigo-600 text-white px-4 py-1.5 rounded text-sm font-medium disabled:opacity-50">
                                {quizBusy ? "Submitting..." : "Submit Quiz"}
                            </button>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}