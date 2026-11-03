import { useRef, useEffect, useState, useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "./api";
import { useFetch, ErrorBanner, Header } from "./ui";
import type { StudentVideo, ProgressResponse, VideoStatus } from "./types";

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
    const { data: videos, loading, error } = useFetch<StudentVideo[]>("/api/student/videos");

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

                {video && <Player video={video} />}
            </main>
        </>
    );
}

// --- Player with heartbeat ---

function Player({ video }: { video: StudentVideo }) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const watchRef = useRef(video.watch_duration_seconds);
    const lastTRef = useRef<number | null>(null);
    const intervalRef = useRef<number | null>(null);

    const [status, setStatus] = useState<VideoStatus>(video.status);

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
        // If near the end, start from 0 (so a finished video doesn't end instantly on replay)
        if (video.last_position_seconds < video.total_duration_seconds - 2) {
            el.currentTime = video.last_position_seconds;
        }
    }, [video.last_position_seconds, video.total_duration_seconds]);

    // Count watched time by media-time deltas (from plan Section 7)
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

    // Start 15s interval on play, clear on pause
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

    // Cleanup on unmount (route change)
    useEffect(() => {
        return () => {
            if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
            // Fire one last heartbeat on unmount
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

    const pct = video.total_duration_seconds > 0
        ? Math.min(100, Math.round((watchRef.current / video.total_duration_seconds) * 100))
        : 0;

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
                className="mt-4 w-full rounded bg-black"
                onLoadedMetadata={handleLoadedMetadata}
                onTimeUpdate={handleTimeUpdate}
                onSeeking={handleSeeking}
                onPlay={handlePlay}
                onPause={handlePause}
                onEnded={handleEnded}
            />
        </div>
    );
}

