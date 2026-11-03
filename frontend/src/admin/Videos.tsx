import { useState } from "react";
import { api } from "../api";
import { useFetch, ErrorBanner } from "../ui";
import type { AdminVideo, ClassItem, DeleteResponse } from "../types";

export function Videos() {
  const { data, loading, error, reload } = useFetch<AdminVideo[]>("/api/admin/videos");
  const classes = useFetch<ClassItem[]>("/api/admin/classes");

  const [classId, setClassId] = useState("");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [duration, setDuration] = useState("");
  const [threshold, setThreshold] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const classMap = new Map(classes.data?.map(c => [c.id, c.name]));

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await api<AdminVideo>("/api/admin/videos", {
        method: "POST",
        body: {
          class_id: Number(classId),
          title,
          video_url: url,
          total_duration_seconds: Number(duration),
          completion_threshold_pct: Number(threshold),
        },
      });
      setClassId("");
      setTitle("");
      setUrl("");
      setDuration("");
      setThreshold("");
      reload();
    } catch (err: any) {
      setFormError(err.message ?? "Failed to create video");
    } finally {
      setBusy(false);
    }
  }

  async function del(id: string) {
    if (!window.confirm("Delete this video? This also deletes every student's progress for it.")) return;
    setBusy(true);
    setFormError(null);
    try {
      await api<DeleteResponse>(`/api/admin/videos/${id}`, { method: "DELETE" });
      reload();
    } catch (err: any) {
      setFormError(err.message ?? "Failed to delete video");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-bold">Videos</h1>

      {error && <ErrorBanner message={error} />}
      {formError && <ErrorBanner message={formError} />}

      <form onSubmit={create} className="flex flex-wrap gap-2 items-end">
        <div>
          <label htmlFor="vid-class" className="block text-sm font-medium">Class</label>
          <select id="vid-class" value={classId} onChange={e => setClassId(e.target.value)} required className="border rounded px-2 py-1">
            <option value="">Select…</option>
            {classes.data?.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="vid-title" className="block text-sm font-medium">Title</label>
          <input id="vid-title" type="text" value={title} onChange={e => setTitle(e.target.value)} required className="border rounded px-2 py-1" />
        </div>
        <div>
          <label htmlFor="vid-url" className="block text-sm font-medium">Video URL</label>
          <input id="vid-url" type="text" value={url} onChange={e => setUrl(e.target.value)} required className="border rounded px-2 py-1" />
        </div>
        <div>
          <label htmlFor="vid-dur" className="block text-sm font-medium">Duration (s)</label>
          <input id="vid-dur" type="number" min={1} value={duration} onChange={e => setDuration(e.target.value)} required className="border rounded px-2 py-1 w-24" />
        </div>
        <div>
          <label htmlFor="vid-thresh" className="block text-sm font-medium">Threshold (%)</label>
          <input id="vid-thresh" type="number" min={1} max={100} value={threshold} onChange={e => setThreshold(e.target.value)} required className="border rounded px-2 py-1 w-24" />
        </div>
        <button type="submit" disabled={busy} className="bg-blue-600 text-white px-4 py-1 rounded disabled:opacity-50">Add</button>
      </form>

      {loading ? (
        <p>Loading…</p>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b">
              <th scope="col" className="text-left p-2">Title</th>
              <th scope="col" className="text-left p-2">Class</th>
              <th scope="col" className="text-left p-2">Duration</th>
              <th scope="col" className="text-left p-2">Threshold</th>
              <th scope="col" className="text-left p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data?.map(v => (
              <tr key={v.id} className="border-b">
                <td className="p-2">{v.title}</td>
                <td className="p-2">{classMap.get(v.class_id) ?? v.class_id}</td>
                <td className="p-2">{v.total_duration_seconds}s</td>
                <td className="p-2">{v.completion_threshold_pct}%</td>
                <td className="p-2">
                  <button onClick={() => del(v.id)} disabled={busy} className="text-red-600 disabled:opacity-50">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
