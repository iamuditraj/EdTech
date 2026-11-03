import { useState } from "react";
import { api } from "../api";
import { useFetch, ErrorBanner } from "../ui";
import type { Subscription, School, ClassItem } from "../types";

export function Subscriptions() {
  const { data, loading, error, reload } = useFetch<Subscription[]>("/api/admin/subscriptions");
  const { data: schools } = useFetch<School[]>("/api/schools");
  const { data: classes } = useFetch<ClassItem[]>("/api/admin/classes");

  const [schoolId, setSchoolId] = useState("");
  const [classId, setClassId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [seats, setSeats] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const schoolName = (id: string) => schools?.find(s => s.id === id)?.name ?? id;
  const className = (id: number) => classes?.find(c => c.id === id)?.name ?? String(id);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await api<Subscription>("/api/admin/subscriptions", {
        method: "PUT",
        body: {
          school_id: schoolId,
          class_id: Number(classId),
          start_date: startDate,
          end_date: endDate,
          total_seats: Number(seats),
        },
      });
      setSchoolId("");
      setClassId("");
      setStartDate("");
      setEndDate("");
      setSeats("");
      reload();
    } catch (err: any) {
      setFormError(err.message ?? "Failed to save subscription");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-bold">Subscriptions</h1>

      {error && <ErrorBanner message={error} />}
      {formError && <ErrorBanner message={formError} />}

      <form onSubmit={save} className="flex flex-wrap gap-2 items-end">
        <div>
          <label htmlFor="sub-school" className="block text-sm font-medium">School</label>
          <select id="sub-school" value={schoolId} onChange={e => setSchoolId(e.target.value)} required className="border rounded px-2 py-1">
            <option value="">Select…</option>
            {schools?.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="sub-class" className="block text-sm font-medium">Class</label>
          <select id="sub-class" value={classId} onChange={e => setClassId(e.target.value)} required className="border rounded px-2 py-1">
            <option value="">Select…</option>
            {classes?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="sub-start" className="block text-sm font-medium">Start Date</label>
          <input id="sub-start" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} required className="border rounded px-2 py-1" />
        </div>
        <div>
          <label htmlFor="sub-end" className="block text-sm font-medium">End Date</label>
          <input id="sub-end" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} required className="border rounded px-2 py-1" />
        </div>
        <div>
          <label htmlFor="sub-seats" className="block text-sm font-medium">Total Seats</label>
          <input id="sub-seats" type="number" min={1} value={seats} onChange={e => setSeats(e.target.value)} required className="border rounded px-2 py-1" />
        </div>
        <button type="submit" disabled={busy} className="bg-blue-600 text-white px-4 py-1 rounded disabled:opacity-50">Save</button>
      </form>

      {loading ? (
        <p>Loading…</p>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b">
              <th scope="col" className="text-left p-2">School</th>
              <th scope="col" className="text-left p-2">Class</th>
              <th scope="col" className="text-left p-2">Start Date</th>
              <th scope="col" className="text-left p-2">End Date</th>
              <th scope="col" className="text-left p-2">Total Seats</th>
            </tr>
          </thead>
          <tbody>
            {data?.map(s => (
              <tr key={s.id} className="border-b">
                <td className="p-2">{schoolName(s.school_id)}</td>
                <td className="p-2">{className(s.class_id)}</td>
                <td className="p-2">{s.start_date}</td>
                <td className="p-2">{s.end_date}</td>
                <td className="p-2">{s.total_seats}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
