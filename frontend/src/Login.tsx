import { useState, useEffect, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "./api";
import { useAuth } from "./auth";
import { useFetch, ErrorBanner } from "./ui";
import type { School, LoginResponse } from "./types";

// --- Shared pieces ---

function SchoolSelect({ schools, value, onChange }: {
    schools: School[];
    value: string;
    onChange: (v: string) => void;
}) {
    return (
        <div>
            <label htmlFor="school" className="block text-sm font-medium text-slate-700">School</label>
            <select
                id="school"
                required
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="mt-1 block w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
                <option value="">Select a school…</option>
                {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
        </div>
    );
}

// --- Student Login ---

function StudentForm({ schools, onSuccess }: { schools: School[]; onSuccess: () => void }) {
    const { login } = useAuth();
    const [schoolId, setSchoolId] = useState("");
    const [regno, setRegno] = useState("");
    const [dob, setDob] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
            const { token } = await api<LoginResponse>("/api/auth/student/login", {
                method: "POST",
                body: { school_id: schoolId, registration_number: regno.trim(), dob: dob.trim() },
            });
            login(token);
            onSuccess();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Login failed.");
        } finally {
            setBusy(false);
        }
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <SchoolSelect schools={schools} value={schoolId} onChange={setSchoolId} />
            <div>
                <label htmlFor="regno" className="block text-sm font-medium text-slate-700">Registration Number</label>
                <input id="regno" type="text" required value={regno} onChange={(e) => setRegno(e.target.value)}
                    className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
                <label htmlFor="dob" className="block text-sm font-medium text-slate-700">Password (DOB: DDMMYYYY)</label>
                <input
                    id="dob"
                    type="password"
                    required
                    placeholder="DDMMYYYY"
                    autoComplete="current-password"
                    value={dob}
                    onChange={(e) => setDob(e.target.value)}
                    className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
            </div>
            <ErrorBanner message={error} />
            <button type="submit" disabled={busy}
                className="w-full rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500">
                {busy ? "Logging in…" : "Log in"}
            </button>
        </form>
    );
}

// --- Teacher Login ---

function TeacherForm({ schools, onSuccess }: { schools: School[]; onSuccess: () => void }) {
    const { login } = useAuth();
    const [schoolId, setSchoolId] = useState("");
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
            const { token } = await api<LoginResponse>("/api/auth/teacher/login", {
                method: "POST",
                body: { school_id: schoolId, username, password },
            });
            login(token);
            onSuccess();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Login failed.");
        } finally {
            setBusy(false);
        }
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <SchoolSelect schools={schools} value={schoolId} onChange={setSchoolId} />
            <div>
                <label htmlFor="username" className="block text-sm font-medium text-slate-700">Username</label>
                <input id="username" type="text" required value={username} onChange={(e) => setUsername(e.target.value)}
                    className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
                <label htmlFor="password" className="block text-sm font-medium text-slate-700">Password</label>
                <input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
                    className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <ErrorBanner message={error} />
            <button type="submit" disabled={busy}
                className="w-full rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500">
                {busy ? "Logging in…" : "Log in"}
            </button>
        </form>
    );
}

// --- Public Login Page (Student / Teacher tabs) ---

export function LoginPage() {
    const navigate = useNavigate();
    const { user } = useAuth();
    const { data: schools, loading, error } = useFetch<School[]>("/api/schools");
    const [tab, setTab] = useState<"student" | "teacher">("student");

    // Already logged in → go home
    useEffect(() => {
        if (user) navigate(user.role === "admin" ? "/admin/schools" : user.role === "teacher" ? "/teacher" : "/student", { replace: true });
    }, [user, navigate]);

    if (user) return null;

    const onSuccess = () => {
        // navigate handled by useEffect above on user change
    };

    return (
        <main className="mx-auto max-w-md p-4">
            <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                <h1 className="text-lg font-semibold text-slate-900">Login</h1>

                {/* Tabs */}
                <div className="mt-4 flex border-b border-slate-200">
                    <button type="button" onClick={() => setTab("student")}
                        className={`px-4 py-2 text-sm font-medium ${tab === "student" ? "border-b-2 border-blue-600 text-blue-600" : "text-slate-500 hover:text-slate-700"}`}>
                        Student
                    </button>
                    <button type="button" onClick={() => setTab("teacher")}
                        className={`px-4 py-2 text-sm font-medium ${tab === "teacher" ? "border-b-2 border-blue-600 text-blue-600" : "text-slate-500 hover:text-slate-700"}`}>
                        Teacher
                    </button>
                </div>

                <div className="mt-4">
                    {loading && <p className="text-sm text-slate-500">Loading…</p>}
                    <ErrorBanner message={error} />
                    {schools && tab === "student" && <StudentForm schools={schools} onSuccess={onSuccess} />}
                    {schools && tab === "teacher" && <TeacherForm schools={schools} onSuccess={onSuccess} />}
                </div>
            </div>
        </main>
    );
}

// --- Admin Login Page ---

export function AdminLoginPage() {
    const navigate = useNavigate();
    const { user, login } = useAuth();
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (user) navigate(user.role === "admin" ? "/admin/schools" : user.role === "teacher" ? "/teacher" : "/student", { replace: true });
    }, [user, navigate]);

    if (user) return null;

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
            const { token } = await api<LoginResponse>("/api/auth/admin/login", {
                method: "POST",
                body: { username, password },
            });
            login(token);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Login failed.");
        } finally {
            setBusy(false);
        }
    }

    return (
        <main className="mx-auto max-w-md p-4">
            <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                <h1 className="text-lg font-semibold text-slate-900">Admin Login</h1>
                <form onSubmit={handleSubmit} className="mt-4 space-y-4">
                    <div>
                        <label htmlFor="admin-user" className="block text-sm font-medium text-slate-700">Username</label>
                        <input id="admin-user" type="text" required value={username} onChange={(e) => setUsername(e.target.value)}
                            className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div>
                        <label htmlFor="admin-pass" className="block text-sm font-medium text-slate-700">Password</label>
                        <input id="admin-pass" type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
                            className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <ErrorBanner message={error} />
                    <button type="submit" disabled={busy}
                        className="w-full rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500">
                        {busy ? "Logging in…" : "Log in"}
                    </button>
                </form>
            </div>
        </main>
    );
}
