import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "./api";
import { useAuth } from "./auth";
import logoImg from "./logo.jpeg";

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

    return (
        <header style={{ background: "#071A3D", padding: "0 24px", height: 60, display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 50, boxShadow: "0 2px 12px rgba(0,0,0,0.3)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <img src={logoImg} alt="Logo" style={{ width: 34, height: 34, borderRadius: "50%", objectFit: "cover", border: "2px solid rgba(255,255,255,0.2)" }} />
                <div style={{ fontFamily: "Poppins, sans-serif", fontWeight: 700, fontSize: 14, color: "#fff" }}>Techies Academy</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>{user.full_name}</div>
                <button
                    type="button"
                    onClick={() => { logout(); navigate(user.role === "admin" ? "/admin/login" : "/login", { replace: true }); }}
                    style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", color: "#fff", fontSize: 12, padding: "7px 14px", borderRadius: 8, cursor: "pointer" }}
                >
                    Logout
                </button>
            </div>
        </header>
    );
}
