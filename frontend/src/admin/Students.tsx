import { useState, useMemo, useRef } from "react";
import { api, ApiError } from "../api";
import { useFetch, ErrorBanner } from "../ui";
import type {
  School,
  ClassItem,
  AdminStudent,
  CsvUploadResponse,
  DeleteResponse,
  MassDeleteResponse,
  CsvRowError,
} from "../types";

export function Students() {
  const [schoolId, setSchoolId] = useState("");
  const [classId, setClassId] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [csvErrors, setCsvErrors] = useState<CsvRowError[]>([]);
  const [success, setSuccess] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: schools, error: schoolsErr } = useFetch<School[]>("/api/schools");
  const { data: classes, error: classesErr } = useFetch<ClassItem[]>("/api/admin/classes");

  const studentPath = schoolId
    ? `/api/admin/students?school_id=${schoolId}${classId ? `&class_id=${classId}` : ""}`
    : null;
  const { data: students, loading, error: studentsErr, reload } = useFetch<AdminStudent[]>(studentPath);

  const classMap = useMemo(() => {
    const m = new Map<number, string>();
    classes?.forEach((c) => m.set(c.id, c.name));
    return m;
  }, [classes]);

  const schoolName = schools?.find((s) => s.id === schoolId)?.name ?? "";
  const className = classes?.find((c) => c.id === Number(classId))?.name ?? "";
  const bothSelected = schoolId !== "" && classId !== "";

  function clearMessages() {
    setFormError(null);
    setCsvErrors([]);
    setSuccess(null);
  }

  async function del(id: string) {
    if (!window.confirm("Delete this student? This also deletes their video progress.")) return;
    setBusy(true);
    clearMessages();
    try {
      await api<DeleteResponse>(`/api/admin/students/${id}`, { method: "DELETE" });
      reload();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Failed to delete student");
    } finally {
      setBusy(false);
    }
  }

  async function uploadCsv(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    if (file.size > 1_048_576) {
      setFormError("File must be under 1 MB.");
      return;
    }
    setBusy(true);
    clearMessages();
    const fd = new FormData();
    fd.append("school_id", schoolId);
    fd.append("class_id", classId);
    fd.append("file", file);
    try {
      const res = await api<CsvUploadResponse>("/api/admin/students/upload-csv", {
        method: "POST",
        form: fd,
      });
      setSuccess(`Inserted ${res.inserted} students.`);
      if (fileRef.current) fileRef.current.value = "";
      reload();
    } catch (err: unknown) {
      if (err instanceof ApiError && err.errors?.length) {
        setCsvErrors(err.errors);
      } else {
        setFormError(err instanceof Error ? err.message : "Upload failed");
      }
    } finally {
      setBusy(false);
    }
  }

  async function massDelete() {
    const count = students?.length ?? 0;
    if (
      !window.confirm(
        `This will delete all ${count} students in ${schoolName} / ${className} and their video progress. This cannot be undone and there is no export.`
      )
    )
      return;
    setBusy(true);
    clearMessages();
    try {
      const res = await api<MassDeleteResponse>(
        `/api/admin/schools/${schoolId}/classes/${classId}/students`,
        { method: "DELETE" }
      );
      setSuccess(`Deleted ${res.deleted} students.`);
      reload();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Mass delete failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 p-4">
      <h1 className="text-2xl font-bold">Students</h1>

      <ErrorBanner message={schoolsErr} />
      <ErrorBanner message={classesErr} />
      <ErrorBanner message={studentsErr} />
      <ErrorBanner message={formError} />

      {success && (
        <div className="rounded border border-green-300 bg-green-50 p-3 text-sm text-green-800">
          {success}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-4">
        <div>
          <label htmlFor="school-filter" className="block text-sm font-medium">
            School
          </label>
          <select
            id="school-filter"
            value={schoolId}
            onChange={(e) => {
              setSchoolId(e.target.value);
              clearMessages();
            }}
            required
            className="rounded border px-2 py-1"
          >
            <option value="">— select school —</option>
            {schools?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="class-filter" className="block text-sm font-medium">
            Class
          </label>
          <select
            id="class-filter"
            value={classId}
            onChange={(e) => {
              setClassId(e.target.value);
              clearMessages();
            }}
            className="rounded border px-2 py-1"
          >
            <option value="">— all classes —</option>
            {classes?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Student table */}
      {loading ? (
        <p>Loading…</p>
      ) : students ? (
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b">
              <th scope="col" className="p-2 text-left">Registration Number</th>
              <th scope="col" className="p-2 text-left">Name</th>
              <th scope="col" className="p-2 text-left">Class</th>
              <th scope="col" className="p-2 text-left">DOB</th>
              <th scope="col" className="p-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {students.map((s) => (
              <tr key={s.id} className="border-b">
                <td className="p-2">{s.registration_number}</td>
                <td className="p-2">{s.full_name}</td>
                <td className="p-2">{classMap.get(s.class_id) ?? s.class_id}</td>
                <td className="p-2">{s.dob}</td>
                <td className="p-2">
                  <button
                    onClick={() => del(s.id)}
                    disabled={busy}
                    className="text-red-600 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {/* Amber callout */}
      {bothSelected && (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          Promote the highest class first (move Class 10 into 11 before Class 9 into 10) because
          registration numbers are unique across the whole school. Keep each roster CSV before
          deleting.
        </div>
      )}

      {/* CSV Upload */}
      {bothSelected && (
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Upload Students CSV</h2>
          <p className="text-sm text-slate-600">
            Columns: name, regno, dob; dob as YYYY-MM-DD, DD-MM-YYYY or DD/MM/YYYY; keep regno as
            text. Upload is all-or-nothing.
          </p>
          <a
            href="/students-template.csv"
            className="text-sm text-blue-600 underline"
          >
            Download template
          </a>
          <form onSubmit={uploadCsv} className="flex items-end gap-2">
            <input ref={fileRef} type="file" accept=".csv" required />
            <button
              type="submit"
              disabled={busy}
              className="rounded bg-blue-600 px-4 py-1 text-white disabled:opacity-50"
            >
              Upload
            </button>
          </form>

          {csvErrors.length > 0 && (
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b">
                  <th scope="col" className="p-2 text-left">Row</th>
                  <th scope="col" className="p-2 text-left">Problem</th>
                </tr>
              </thead>
              <tbody>
                {csvErrors.map((e, i) => (
                  <tr key={i} className="border-b">
                    <td className="p-2">{e.row}</td>
                    <td className="p-2">{e.problem}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Mass Delete */}
      {bothSelected && (
        <div>
          <button
            onClick={massDelete}
            disabled={busy}
            className="rounded bg-red-600 px-4 py-1 text-white disabled:opacity-50"
          >
            Delete all students in this class
          </button>
        </div>
      )}
    </div>
  );
}
