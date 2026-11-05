import { useState } from "react";
import { api } from "../api";
import { useFetch, ErrorBanner } from "../ui";
import type { AdminVideo, ClassItem, DeleteResponse, McqItem } from "../types";

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

  function addQuestion() {
    setMcqs(prev => [...prev, { question: "", options: ["", "", "", ""], correct_index: 0 }]);
  }

  function updateQuestionText(qIndex: number, text: string) {
    setMcqs(prev => prev.map((q, i) => i === qIndex ? { ...q, question: text } : q));
  }

  function updateOptionText(qIndex: number, optIndex: number, text: string) {
    setMcqs(prev => prev.map((q, i) => {
      if (i !== qIndex) return q;
      const opts = [...q.options];
      opts[optIndex] = text;
      return { ...q, options: opts };
    }));
  }

  function setCorrectIndex(qIndex: number, correctIdx: number) {
    setMcqs(prev => prev.map((q, i) => i === qIndex ? { ...q, correct_index: correctIdx } : q));
  }

  function removeQuestion(qIndex: number) {
    setMcqs(prev => prev.filter((_, i) => i !== qIndex));
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);

    for (let i = 0; i < mcqs.length; i++) {
      const q = mcqs[i];
      if (!q.question.trim()) {
        setFormError(`Question #${i + 1} text is required.`);
        setBusy(false);
        return;
      }
      if (q.options.some(opt => !opt.trim())) {
        setFormError(`All 4 options for Question #${i + 1} must be filled.`);
        setBusy(false);
        return;
      }
    }

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
          mcqs,
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

      <form onSubmit={create} className="space-y-4 rounded border p-4 bg-slate-50">
        <h2 className="text-base font-semibold text-slate-800">Add New Video</h2>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label htmlFor="vid-class" className="block text-sm font-medium">Class</label>
            <select id="vid-class" value={classId} onChange={e => setClassId(e.target.value)} required className="border rounded px-2 py-1 bg-white">
              <option value="">Select…</option>
              {classes.data?.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[180px]">
            <label htmlFor="vid-title" className="block text-sm font-medium">Title</label>
            <input id="vid-title" type="text" value={title} onChange={e => setTitle(e.target.value)} required className="w-full border rounded px-2 py-1 bg-white" />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label htmlFor="vid-url" className="block text-sm font-medium">Video URL</label>
            <input id="vid-url" type="text" value={url} onChange={e => setUrl(e.target.value)} required className="w-full border rounded px-2 py-1 bg-white" />
          </div>
          <div>
            <label htmlFor="vid-dur" className="block text-sm font-medium">Duration (s)</label>
            <input id="vid-dur" type="number" min={1} value={duration} onChange={e => setDuration(e.target.value)} required className="border rounded px-2 py-1 w-24 bg-white" />
          </div>
          <div>
            <label htmlFor="vid-thresh" className="block text-sm font-medium">Threshold (%)</label>
            <input id="vid-thresh" type="number" min={1} max={100} value={threshold} onChange={e => setThreshold(e.target.value)} required className="border rounded px-2 py-1 w-24 bg-white" />
          </div>
        </div>

        <div>
          <label htmlFor="vid-notes" className="block text-sm font-medium">Notes URL (optional)</label>
          <input
            id="vid-notes"
            type="url"
            placeholder="https://drive.google.com/... or PDF link"
            value={notesUrl}
            onChange={e => setNotesUrl(e.target.value)}
            className="w-full max-w-xl border rounded px-2 py-1 bg-white"
          />
        </div>

        {/* MCQ Builder */}
        <div className="border-t pt-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-800">MCQ Test Questions ({mcqs.length})</span>
            <button
              type="button"
              onClick={addQuestion}
              className="text-xs bg-slate-200 hover:bg-slate-300 px-2 py-1 rounded text-slate-800"
            >
              + Add Question
            </button>
          </div>

          {mcqs.map((q, qIdx) => (
            <div key={qIdx} className="p-3 bg-white border rounded space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-600">Q{qIdx + 1}</span>
                <input
                  type="text"
                  placeholder="Question text"
                  value={q.question}
                  onChange={e => updateQuestionText(qIdx, e.target.value)}
                  className="flex-1 border rounded px-2 py-1 text-sm"
                  required
                />
                <button
                  type="button"
                  onClick={() => removeQuestion(qIdx)}
                  className="text-xs text-red-600 hover:underline px-1"
                >
                  Remove
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {q.options.map((opt, optIdx) => (
                  <label key={optIdx} className="flex items-center gap-2 border rounded p-1.5 bg-slate-50">
                    <input
                      type="radio"
                      name={`correct-${qIdx}`}
                      checked={q.correct_index === optIdx}
                      onChange={() => setCorrectIndex(qIdx, optIdx)}
                      title="Mark as correct answer"
                    />
                    <input
                      type="text"
                      placeholder={`Option ${String.fromCharCode(65 + optIdx)}`}
                      value={opt}
                      onChange={e => updateOptionText(qIdx, optIdx, e.target.value)}
                      className="flex-1 border rounded px-1.5 py-0.5 bg-white text-xs"
                      required
                    />
                  </label>
                ))}
              </div>
              <p className="text-[11px] text-slate-500">Radio button selects the correct answer.</p>
            </div>
          ))}
        </div>

        <div>
          <button type="submit" disabled={busy} className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm disabled:opacity-50">
            {busy ? "Saving…" : "Save Video"}
          </button>
        </div>
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
                <td className="p-2 font-medium">{v.title}</td>
                <td className="p-2">{classMap.get(v.class_id) ?? v.class_id}</td>
                <td className="p-2">{v.total_duration_seconds}s</td>
                <td className="p-2">{v.completion_threshold_pct}%</td>
                <td className="p-2">
                  {v.notes_url ? (
                    <a href={v.notes_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline text-xs">
                      Notes ↗
                    </a>
                  ) : (
                    <span className="text-slate-400 text-xs">—</span>
                  )}
                </td>
                <td className="p-2 text-xs">
                  {v.mcqs && v.mcqs.length > 0 ? `${v.mcqs.length} Qs` : <span className="text-slate-400">—</span>}
                </td>
                <td className="p-2">
                  <button onClick={() => del(v.id)} disabled={busy} className="text-red-600 hover:underline text-xs disabled:opacity-50">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
