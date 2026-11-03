import { useState } from "react";
import type { School, DeleteResponse } from "../types";
import { api } from "../api";
import { useFetch, ErrorBanner } from "../ui";

export function Schools() {
    const { data: schools, loading, error, reload } = useFetch<School[]>("/api/schools");
    const [name, setName] = useState("");
    const [busy, setBusy] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);

    async function create(e: React.FormEvent) {
        e.preventDefault();
        setBusy(true);
        setFormError(null);
        try {
            await api<School>("/api/admin/schools", { method: "POST", body: { name } });
            setName("");
            reload();
        } catch (err) {
            setFormError((err as Error).message);
        } finally {
            setBusy(false);
        }
    }

    async function remove(id: string) {
        if (!window.confirm("Delete this school?")) return;
        setBusy(true);
        setFormError(null);
        try {
            await api<DeleteResponse>(`/api/admin/schools/${id}`, { method: "DELETE" });
            reload();
        } catch (err) {
            setFormError((err as Error).message);
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="mx-auto max-w-2xl space-y-6 p-4">
            <h1 className="text-xl font-semibold">Schools</h1>

            <ErrorBanner message={error} />
            <ErrorBanner message={formError} />

            <form onSubmit={create} className="flex items-end gap-2">
                <div>
                    <label htmlFor="school-name" className="block text-sm font-medium">Name</label>
                    <input
                        id="school-name"
                        type="text"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="mt-1 rounded border border-slate-300 px-3 py-1.5 text-sm"
                    />
                </div>
                <button
                    type="submit"
                    disabled={busy}
                    className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
                >
                    Add School
                </button>
            </form>

            {loading && <p className="text-sm text-slate-500">Loading…</p>}

            {schools && schools.length > 0 && (
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b text-left">
                            <th scope="col" className="py-2">Name</th>
                            <th scope="col" className="py-2">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {schools.map((s) => (
                            <tr key={s.id} className="border-b">
                                <td className="py-2">{s.name}</td>
                                <td className="py-2">
                                    <button
                                        type="button"
                                        disabled={busy}
                                        onClick={() => remove(s.id)}
                                        className="text-red-600 hover:text-red-800 disabled:opacity-50"
                                    >
                                        Delete
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}
