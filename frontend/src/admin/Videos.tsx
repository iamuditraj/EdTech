import { useState } from "react";
import { api } from "../api";
import { useFetch, ErrorBanner } from "../ui";
import type { AdminVideo, ClassItem, DeleteResponse, McqItem } from "../types";

const BLANK_MCQ = (): McqItem => ({ question: "", options: ["", "", "", ""], correct_index: 0 });

export function Videos() {
  const { data, loading, error, reload } = useFetch<AdminVideo[]>("/api/admin/videos");
  const classes = useFetch<ClassItem[]>("/api/admin/classes");

  const [classId, setClassId] = useState("");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [duration, setDuration] = useState("");
  const [threshold, setThreshold] = useState("");
  const [notesUrl, setNotesUrl] = useState("");
  const [mcqs, setMcqs] = useState<McqItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const classMap = new Map(classes.data?.map(c => [c.id, c.name]));

  function updateMcq(idx: number, patch: Partial<McqItem>) {
    setMcqs(prev => prev.map((m, i) => i === idx ? { ...m, ...patch } : m));
  }

  function updateOption(qIdx: number, oIdx: number, value: string) {
    setMcqs(prev => prev.map((m, i) => {
      if (i !== qIdx) return m;
      const opts = [...m.options];
      opts[oIdx] = value;
      return { ...m, options: opts };
    }));
  }

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
          notes_url: notesUrl.trim() || null,
          mcqs: mcqs.map(m => ({ question: m.question, options: m.options, correct_index: m.correct_index })),
        },
      });
      setClassId("");
      setTitle("");
      setUrl("");
      setDuration("");
      setThreshold("");
      setNotesUrl("");
      setMcqs([]);
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

      <form onSubmit={create} className="space-y-3">
        <div className="flex flex-wrap gap-2 items-end">
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
          <div>
            <label htmlFor="vid-notes" className="block text-sm font-medium">Notes URL</label>
            <input id="vid-notes" type="url" value={notesUrl} onChange={e => setNotesUrl(e.target.value)} placeholder="https://..." className="border rounded px-2 py-1" />
          </div>
        </div>

        {/* MCQ Builder */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">MCQs ({mcqs.length})</span>
            <button type="button" onClick={() => setMcqs(prev => [...prev, BLANK_MCQ()])} className="text-sm text-blue-600 hover:underline">+ Add Question</button>
          </div>
          {mcqs.map((m, qi) => (
            <div key={qi} className="border rounded p-3 space-y-2 bg-slate-50">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-slate-500">Q{qi + 1}</span>
                <input
                  type="text" value={m.question} placeholder="Question text"
                  onChange={e => updateMcq(qi, { question: e.target.value })}
                  required className="flex-1 border rounded px-2 py-1 text-sm"
                />
                <button type="button" onClick={() => setMcqs(prev => prev.filter((_, i) => i !== qi))} className="text-red-500 text-sm">✕</button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {m.options.map((opt, oi) => (
                  <label key={oi} className="flex items-center gap-1">
                    <input
                      type="radio" name={`correct-${qi}`} checked={m.correct_index === oi}
                      onChange={() => updateMcq(qi, { correct_index: oi })}
                    />
                    <input
                      type="text" value={opt} placeholder={`Option ${oi + 1}`}
                      onChange={e => updateOption(qi, oi, e.target.value)}
                      required className="border rounded px-2 py-1 text-sm flex-1"
                    />
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>

        <button type="submit" disabled={busy} className="bg-blue-600 text-white px-4 py-1 rounded disabled:opacity-50">Add Video</button>
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
              <th scope="col" className="text-left p-2">Notes</th>
              <th scope="col" className="text-left p-2">MCQs</th>
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
                  {v.notes_url ? <a href={v.notes_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Link</a> : "—"}
                </td>
                <td className="p-2">{v.mcqs?.length || 0} Qs</td>
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
