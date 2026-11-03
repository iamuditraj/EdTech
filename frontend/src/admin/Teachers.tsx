import { useState, useMemo } from "react";
import { api } from "../api";
import { useFetch, ErrorBanner } from "../ui";
import type { Teacher, School, ClassItem, Subscription, DeleteResponse } from "../types";

export function Teachers() {
  const { data: teachers, loading, error, reload } = useFetch<Teacher[]>("/api/admin/teachers");
  const { data: schools } = useFetch<School[]>("/api/schools");
  const { data: classes } = useFetch<ClassItem[]>("/api/admin/classes");
  const { data: subscriptions } = useFetch<Subscription[]>("/api/admin/subscriptions");

  const [schoolId, setSchoolId] = useState("");
  const [classId, setClassId] = useState("");
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const schoolMap = useMemo(
    () => new Map<string, string>((schools ?? []).map(s => [s.id, s.name])),
    [schools],
  );

  const classMap = useMemo(
    () => new Map<number, string>((classes ?? []).map(c => [c.id, c.name])),
    [classes],
  );

  const availableClasses = useMemo(() => {
    if (!schoolId || !subscriptions || !classes) return [];
    const classIds = new Set(subscriptions.filter(s => s.school_id === schoolId).map(s => s.class_id));
    return classes.filter(c => classIds.has(c.id));
  }, [schoolId, subscriptions, classes]);

  async function upsert(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await api<Teacher>("/api/admin/teachers", {
        method: "PUT",
        body: { school_id: schoolId, class_id: Number(classId), full_name: fullName, username, password },
      });
      setSchoolId("");
      setClassId("");
      setFullName("");
      setUsername("");
      setPassword("");
      reload();
    } catch (err: any) {
      setFormError(err.message ?? "Failed to save teacher");
    } finally {
      setBusy(false);
    }
  }

  async function del(id: string) {
    if (!window.confirm("Delete this teacher?")) return;
    setBusy(true);
    setFormError(null);
    try {
      await api<DeleteResponse>(`/api/admin/teachers/${id}`, { method: "DELETE" });
      reload();
    } catch (err: any) {
      setFormError(err.message ?? "Failed to delete teacher");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-bold">Teachers</h1>

      {error && <ErrorBanner message={error} />}
      {formError && <ErrorBanner message={formError} />}

      <form onSubmit={upsert} className="space-y-2">
        <p className="text-sm font-medium">Set / replace / reset the teacher of this class</p>

        <div className="flex flex-wrap gap-2 items-end">
          <div>
            <label htmlFor="t-school" className="block text-sm font-medium">School</label>
            <select id="t-school" value={schoolId} onChange={e => { setSchoolId(e.target.value); setClassId(""); }} required className="border rounded px-2 py-1">
              <option value="">— select —</option>
              {schools?.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          <div>
            <label htmlFor="t-class" className="block text-sm font-medium">Class</label>
            <select id="t-class" value={classId} onChange={e => setClassId(e.target.value)} required className="border rounded px-2 py-1">
              <option value="">— select —</option>
              {availableClasses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <div>
            <label htmlFor="t-name" className="block text-sm font-medium">Full Name</label>
            <input id="t-name" type="text" value={fullName} onChange={e => setFullName(e.target.value)} required className="border rounded px-2 py-1" />
          </div>

          <div>
            <label htmlFor="t-user" className="block text-sm font-medium">Username</label>
            <input id="t-user" type="text" value={username} onChange={e => setUsername(e.target.value)} required className="border rounded px-2 py-1" />
          </div>

          <div>
            <label htmlFor="t-pass" className="block text-sm font-medium">Password</label>
            <input id="t-pass" type="password" value={password} onChange={e => setPassword(e.target.value)} required maxLength={72} className="border rounded px-2 py-1" />
          </div>

          <button type="submit" disabled={busy} className="bg-blue-600 text-white px-4 py-1 rounded disabled:opacity-50">Save</button>
        </div>
      </form>

      {loading ? (
        <p>Loading…</p>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b">
              <th scope="col" className="text-left p-2">Full Name</th>
              <th scope="col" className="text-left p-2">Username</th>
              <th scope="col" className="text-left p-2">School</th>
              <th scope="col" className="text-left p-2">Class</th>
              <th scope="col" className="text-left p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {teachers?.map(t => (
              <tr key={t.id} className="border-b">
                <td className="p-2">{t.full_name}</td>
                <td className="p-2">{t.username}</td>
                <td className="p-2">{schoolMap.get(t.school_id) ?? t.school_id}</td>
                <td className="p-2">{classMap.get(t.class_id) ?? t.class_id}</td>
                <td className="p-2">
                  <button onClick={() => del(t.id)} disabled={busy} className="text-red-600 disabled:opacity-50">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
