import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "./api";
import { useAuth } from "./auth";

// --- useFetch ---

interface FetchResult<T> {
    data: T | null;
    loading: boolean;
    error: string | null;
    reload: () => void;
}

export function useFetch<T>(path: string | null): FetchResult<T> {
    const [data, setData] = useState<T | null>(null);
    const [loading, setLoading] = useState(path !== null);
    const [error, setError] = useState<string | null>(null);
    const [tick, setTick] = useState(0);

    const reload = useCallback(() => setTick((t) => t + 1), []);

    useEffect(() => {
        if (path === null) {
            setData(null);
            setLoading(false);
            setError(null);
            return;
        }
        let cancelled = false;
        setLoading(true);
        setError(null);
        api<T>(path)
            .then((d) => { if (!cancelled) { setData(d); setLoading(false); } })
            .catch((e: Error) => { if (!cancelled) { setError(e.message); setLoading(false); } });
        return () => { cancelled = true; };
    }, [path, tick]);

    return { data, loading, error, reload };
}

// --- ErrorBanner ---

export function ErrorBanner({ message }: { message: string | null }) {
    if (!message) return null;
    return (
        <div role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            {message}
        </div>
    );
}

// --- Header ---

export function Header() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();

    if (!user) return null;

    const parts: string[] = [user.full_name];
    if (user.role === "teacher" || user.role === "student") {
        parts.push(user.school_name, user.class_name);
    }

    return (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-semibold text-slate-900">EdTech</span>
                <span className="text-slate-600">{parts.join(" · ")}</span>
            </div>
            <button
                type="button"
                onClick={() => { logout(); navigate(user.role === "admin" ? "/admin/login" : "/login", { replace: true }); }}
                className="rounded px-3 py-1 text-red-600 hover:bg-red-50 hover:text-red-800"
            >
                Logout
            </button>
        </header>
    );
}
