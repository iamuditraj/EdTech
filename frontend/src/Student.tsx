import { useRef, useEffect, useState, useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "./api";
import { useFetch, ErrorBanner, Header } from "./ui";
import type { StudentVideo, ProgressResponse, VideoStatus, QuizSubmitResponse } from "./types";

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

                {loading && <p className="mt-4 text-sm text-slate-500">Loading…</p>}
                <ErrorBanner message={error} />

                {videos && videos.length === 0 && (
                    <p className="mt-4 text-sm text-slate-500">No videos have been added for your class yet.</p>
                )}

                <div className="mt-4 grid gap-4 grid-cols-1 sm:grid-cols-2">
                    {videos?.map((v) => {
                        const pct = v.total_duration_seconds > 0
                            ? Math.min(100, Math.round((v.watch_duration_seconds / v.total_duration_seconds) * 100))
                            : 0;
                        return (
                            <Link
                                key={v.id}
                                to={`/student/videos/${v.id}`}
                                className="block rounded-lg border border-slate-200 bg-white p-4 shadow-sm hover:border-blue-300"
                            >
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
                                    {pct}% watched · Complete at {v.completion_threshold_pct}%
                                </p>
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
                {loading && <p className="text-sm text-slate-500">Loading…</p>}
                <ErrorBanner message={error} />

                {notFound && (
                    <div className="text-sm text-slate-700">
                        <p>Video not found.</p>
                        <Link to="/student" className="text-blue-600 hover:underline">← Back to videos</Link>
                    </div>
                )}

                {video && <Player video={video} onQuizComplete={reload} />}
            </main>
        </>
    );
}

// --- Player with heartbeat, notes & quiz ---

function Player({ video, onQuizComplete }: { video: StudentVideo; onQuizComplete: () => void }) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const watchRef = useRef(video.watch_duration_seconds);
    const lastTRef = useRef<number | null>(null);
    const intervalRef = useRef<number | null>(null);

    const [status, setStatus] = useState<VideoStatus>(video.status);
    const [quizScore, setQuizScore] = useState<number | null>(video.quiz_score ?? null);
    const [quizTotal, setQuizTotal] = useState<number | null>(video.quiz_total ?? null);
    const [quizAnswers, setQuizAnswers] = useState<number[] | null>(video.quiz_answers ?? null);
    const [showQuiz, setShowQuiz] = useState(false);
    const [userAnswers, setUserAnswers] = useState<Record<number, number>>({});
    const [quizSubmitting, setQuizSubmitting] = useState(false);
    const [quizError, setQuizError] = useState<string | null>(null);

    // Keep state in sync if video prop changes
    useEffect(() => {
        setStatus(video.status);
        setQuizScore(video.quiz_score ?? null);
        setQuizTotal(video.quiz_total ?? null);
        setQuizAnswers(video.quiz_answers ?? null);
    }, [video]);

    // Send heartbeat — silent on failure (401 still triggers logout via api.ts)
    const sendHeartbeat = useCallback(() => {
        const el = videoRef.current;
        if (!el) return;
        api<ProgressResponse>(`/api/student/videos/${video.id}/progress`, {
            method: "POST",
            body: {
                watch_seconds: watchRef.current,
                position_seconds: el.currentTime,
            },
        })
            .then((res) => {
                setStatus(res.status);
                watchRef.current = Math.max(watchRef.current, res.watch_duration_seconds);
            })
            .catch(() => { /* silent — next tick retries */ });
    }, [video.id]);

    // Resume position on load
    const handleLoadedMetadata = useCallback(() => {
        const el = videoRef.current;
        if (!el) return;
        if (video.last_position_seconds < video.total_duration_seconds - 2) {
            el.currentTime = video.last_position_seconds;
        }
    }, [video.last_position_seconds, video.total_duration_seconds]);

    // Count watched time by media-time deltas
    const handleTimeUpdate = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
        const t = e.currentTarget.currentTime;
        if (lastTRef.current !== null) {
            const d = t - lastTRef.current;
            if (d > 0 && d < 3) {
                watchRef.current += d;
            }
        }
        lastTRef.current = t;
    }, []);

    const handleSeeking = useCallback(() => {
        lastTRef.current = null;
    }, []);

    const handlePlay = useCallback(() => {
        if (intervalRef.current !== null) return;
        intervalRef.current = window.setInterval(sendHeartbeat, 15_000);
    }, [sendHeartbeat]);

    const clearInterval_ = useCallback(() => {
        if (intervalRef.current !== null) {
            window.clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
    }, []);

    const handlePause = useCallback(() => {
        clearInterval_();
        sendHeartbeat();
    }, [clearInterval_, sendHeartbeat]);

    const handleEnded = useCallback(() => {
        clearInterval_();
        sendHeartbeat();
    }, [clearInterval_, sendHeartbeat]);

    useEffect(() => {
        return () => {
            if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
            const el = videoRef.current;
            if (el) {
                api<ProgressResponse>(`/api/student/videos/${video.id}/progress`, {
                    method: "POST",
                    body: {
                        watch_seconds: watchRef.current,
                        position_seconds: el.currentTime,
                    },
                }).catch(() => {});
            }
        };
    }, [video.id]);

    async function handleQuizSubmit(e: React.FormEvent) {
        e.preventDefault();
        setQuizSubmitting(true);
        setQuizError(null);

        const answersList = video.mcqs.map((_, i) => userAnswers[i]);
        if (answersList.some((a) => a === undefined)) {
            setQuizError("Please answer every question before submitting.");
            setQuizSubmitting(false);
            return;
        }

        try {
            const res = await api<QuizSubmitResponse>(`/api/student/videos/${video.id}/quiz`, {
                method: "POST",
                body: { answers: answersList },
            });
            setQuizScore(res.quiz_score);
            setQuizTotal(res.quiz_total);
            setQuizAnswers(res.quiz_answers);
            if (status === "not_started") {
                setStatus("in_progress");
            }
            onQuizComplete();
        } catch (err: any) {
            setQuizError(err.message ?? "Failed to submit quiz.");
        } finally {
            setQuizSubmitting(false);
        }
    }

    const pct = video.total_duration_seconds > 0
        ? Math.min(100, Math.round((watchRef.current / video.total_duration_seconds) * 100))
        : 0;

    const hasAttempted = quizScore !== null;
    const hasMcqs = video.mcqs && video.mcqs.length > 0;

    return (
        <div>
            <Link to="/student" className="text-sm text-blue-600 hover:underline">← Back to videos</Link>
            <h1 className="mt-2 text-lg font-semibold text-slate-900">{video.title}</h1>
            <div className="mt-1 flex items-center gap-2">
                <StatusBadge status={status} />
                <span className="text-xs text-slate-500">{pct}% watched · Complete at {video.completion_threshold_pct}%</span>
            </div>

            <video
                ref={videoRef}
                src={video.video_url}
                controls
                className="mt-4 w-full rounded bg-black shadow"
                onLoadedMetadata={handleLoadedMetadata}
                onTimeUpdate={handleTimeUpdate}
                onSeeking={handleSeeking}
                onPlay={handlePlay}
                onPause={handlePause}
                onEnded={handleEnded}
            />

            {/* Action Bar below Video */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                    {video.notes_url && (
                        <a
                            href={video.notes_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        >
                            📄 Download Notes
                        </a>
                    )}

                    {hasMcqs && (
                        <button
                            type="button"
                            onClick={() => setShowQuiz((prev) => !prev)}
                            className="inline-flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                        >
                            📝 {hasAttempted ? (showQuiz ? "Hide Quiz Review" : "Review Quiz") : (showQuiz ? "Hide Test" : "Take Test")}
                        </button>
                    )}
                </div>

                {hasAttempted && (
                    <span className="inline-flex items-center rounded-full bg-purple-100 px-3 py-1 text-xs font-semibold text-purple-800">
                        Quiz Score: {quizScore} / {quizTotal}
                    </span>
                )}
            </div>

            {/* Quiz Form or Review View */}
            {showQuiz && hasMcqs && (
                <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm space-y-4">
                    <div className="flex items-center justify-between border-b pb-2">
                        <h2 className="text-base font-semibold text-slate-900">
                            {hasAttempted ? "Quiz Review" : "Video Quiz"}
                        </h2>
                        {hasAttempted && (
                            <span className="text-xs text-slate-500 font-medium">
                                Score: {quizScore}/{quizTotal} ({Math.round(((quizScore ?? 0) / (quizTotal || 1)) * 100)}%)
                            </span>
                        )}
                    </div>

                    {quizError && <ErrorBanner message={quizError} />}

                    {!hasAttempted ? (
                        /* Test Taking Mode */
                        <form onSubmit={handleQuizSubmit} className="space-y-4">
                            {video.mcqs.map((q, qIdx) => (
                                <fieldset key={qIdx} className="rounded border border-slate-200 p-3 bg-slate-50">
                                    <legend className="px-1 text-xs font-semibold text-slate-700">
                                        Question {qIdx + 1} of {video.mcqs.length}
                                    </legend>
                                    <p className="mt-1 text-sm font-medium text-slate-900">{q.question}</p>
                                    <div className="mt-2 space-y-1.5">
                                        {q.options.map((opt, optIdx) => (
                                            <label
                                                key={optIdx}
                                                className={`flex cursor-pointer items-center gap-2 rounded border p-2 text-xs transition-colors ${
                                                    userAnswers[qIdx] === optIdx
                                                        ? "border-blue-500 bg-blue-50 font-medium text-blue-900"
                                                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                                                }`}
                                            >
                                                <input
                                                    type="radio"
                                                    name={`q-${qIdx}`}
                                                    checked={userAnswers[qIdx] === optIdx}
                                                    onChange={() => setUserAnswers((prev) => ({ ...prev, [qIdx]: optIdx }))}
                                                />
                                                <span>{opt}</span>
                                            </label>
                                        ))}
                                    </div>
                                </fieldset>
                            ))}

                            <div className="flex justify-end">
                                <button
                                    type="submit"
                                    disabled={quizSubmitting}
                                    className="rounded bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                                >
                                    {quizSubmitting ? "Submitting…" : "Submit Quiz"}
                                </button>
                            </div>
                        </form>
                    ) : (
                        /* Review Mode (Correct vs Wrong Answers) */
                        <div className="space-y-4">
                            {video.mcqs.map((q, qIdx) => {
                                const selected = q.selected_index ?? quizAnswers?.[qIdx];
                                const correct = q.correct_index;
                                const isCorrect = selected === correct;

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
                                                const isThisSelected = selected === optIdx;
                                                const isThisCorrect = correct === optIdx;

                                                let style = "border-slate-200 bg-white text-slate-600";
                                                let badge = null;

                                                if (isThisCorrect && isThisSelected) {
                                                    style = "border-green-500 bg-green-100/70 font-semibold text-green-900";
                                                    badge = "✓ Your Answer (Correct)";
                                                } else if (isThisCorrect) {
                                                    style = "border-green-500 bg-green-50 font-semibold text-green-900";
                                                    badge = "✓ Correct Answer";
                                                } else if (isThisSelected) {
                                                    style = "border-red-500 bg-red-100/70 font-semibold text-red-900";
                                                    badge = "✗ Your Answer (Wrong)";
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
                            })}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

