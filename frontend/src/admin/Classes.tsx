import { useState } from "react";
import { api } from "../api";
import { useFetch, ErrorBanner } from "../ui";
import type { ClassItem, DeleteResponse } from "../types";

export function Classes() {
  const { data, loading, error, reload } = useFetch<ClassItem[]>("/api/admin/classes");
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await api<ClassItem>("/api/admin/classes", {
        method: "POST",
        body: { id: Number(id), name },
      });
      setId("");
      setName("");
      reload();
    } catch (err: any) {
      setFormError(err.message ?? "Failed to create class");
    } finally {
      setBusy(false);
    }
  }

  async function del(classId: number) {
    if (!window.confirm("Delete this class?")) return;
    setBusy(true);
    setFormError(null);
    try {
      await api<DeleteResponse>(`/api/admin/classes/${classId}`, { method: "DELETE" });
      reload();
    } catch (err: any) {
      setFormError(err.message ?? "Failed to delete class");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-bold">Classes</h1>

      {error && <ErrorBanner message={error} />}
      {formError && <ErrorBanner message={formError} />}

      <form onSubmit={create} className="flex gap-2 items-end">
        <div>
          <label htmlFor="class-id" className="block text-sm font-medium">ID</label>
          <input id="class-id" type="number" value={id} onChange={e => setId(e.target.value)} required className="border rounded px-2 py-1" />
        </div>
        <div>
          <label htmlFor="class-name" className="block text-sm font-medium">Name</label>
          <input id="class-name" type="text" value={name} onChange={e => setName(e.target.value)} required className="border rounded px-2 py-1" />
        </div>
        <button type="submit" disabled={busy} className="bg-blue-600 text-white px-4 py-1 rounded disabled:opacity-50">Add</button>
      </form>

      {loading ? (
        <p>Loading…</p>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b">
              <th scope="col" className="text-left p-2">ID</th>
              <th scope="col" className="text-left p-2">Name</th>
              <th scope="col" className="text-left p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data?.map(c => (
              <tr key={c.id} className="border-b">
                <td className="p-2">{c.id}</td>
                <td className="p-2">{c.name}</td>
                <td className="p-2">
                  <button onClick={() => del(c.id)} disabled={busy} className="text-red-600 disabled:opacity-50">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
