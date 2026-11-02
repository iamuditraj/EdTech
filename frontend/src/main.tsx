import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Outlet, Route, Routes, Link } from "react-router-dom";
import "./index.css";
import { api } from "./api";
import type { School } from "./types";

function SmokeCheckLogin({ title }: { title: string }) {
    const [schools, setSchools] = useState<School[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        api<School[]>("/api/schools")
            .then(setSchools)
            .catch((err: Error) => setError(err.message));
    }, []);

    return (
        <main className="mx-auto max-w-md p-4">
            <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                <h1 className="text-lg font-semibold">{title}</h1>
                <p className="mt-1 text-sm text-slate-600">Phase 0 connectivity check (`GET /api/schools`):</p>
                {error && (
                    <div role="alert" className="mt-3 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
                        {error}
                    </div>
                )}
                {!error && !schools && <p className="mt-3 text-sm text-slate-500">Loading...</p>}
                {schools && (
                    <ul className="mt-3 list-inside list-disc text-sm text-slate-800">
                        {schools.length === 0 ? <li>0 schools in DB (200 OK)</li> : schools.map((s) => <li key={s.id}>{s.name}</li>)}
                    </ul>
                )}
            </div>
        </main>
    );
}

function Placeholder({ name }: { name: string }) {
    return <div className="p-4 text-sm text-slate-700">{name} placeholder</div>;
}

function AdminPlaceholderLayout() {
    const tabs = ["schools", "classes", "videos", "subscriptions", "teachers", "students"];
    return (
        <div className="p-4">
            <nav className="mb-4 flex flex-wrap gap-2 border-b border-slate-200 pb-2 text-sm">
                {tabs.map((t) => (
                    <Link key={t} to={`/admin/${t}`} className="rounded px-2 py-1 text-blue-600 hover:bg-slate-100">
                        {t}
                    </Link>
                ))}
            </nav>
            <Outlet />
        </div>
    );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <BrowserRouter>
            <Routes>
                <Route path="/login" element={<SmokeCheckLogin title="Student / Teacher Login" />} />
                <Route path="/admin/login" element={<SmokeCheckLogin title="Admin Login" />} />
                <Route path="/student" element={<Placeholder name="Student Video List" />} />
                <Route path="/student/videos/:id" element={<Placeholder name="Student Video Player" />} />
                <Route path="/teacher" element={<Placeholder name="Teacher Matrix" />} />
                <Route path="/admin" element={<AdminPlaceholderLayout />}>
                    <Route index element={<Navigate to="schools" replace />} />
                    <Route path="schools" element={<Placeholder name="Admin Schools" />} />
                    <Route path="classes" element={<Placeholder name="Admin Classes" />} />
                    <Route path="videos" element={<Placeholder name="Admin Videos" />} />
                    <Route path="subscriptions" element={<Placeholder name="Admin Subscriptions" />} />
                    <Route path="teachers" element={<Placeholder name="Admin Teachers" />} />
                    <Route path="students" element={<Placeholder name="Admin Students" />} />
                </Route>
                <Route path="*" element={<Navigate to="/login" replace />} />
            </Routes>
        </BrowserRouter>
    </React.StrictMode>
);