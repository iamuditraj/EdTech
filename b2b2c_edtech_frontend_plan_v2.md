# B2B2C EdTech Frontend: Context, Decisions & Build Plan (v2 — TypeScript + Tailwind CSS)

## 1. How to use this document

Context for building the frontend of the platform whose backend is already done. Attach it together with `backend_summary_frontend_handoff_guide.md`. **That guide is the source of truth for every endpoint, body, and response; this plan does not repeat it.** If the two ever disagree, the guide (and the backend code) wins.

When helping with this project in a new chat:

* Follow every decision below. Build **one phase at a time** (Section 9) and wait for confirmation before moving to the next phase.
* This is a **small-scale site with nothing critical**. Choose **ease and simplicity over extra features**. The backend (DB roles + RLS + JWT) does the real security; the frontend only has to be type-safe, responsive, and honest about errors.
* Keep code **flat and simple**: few files, strict TypeScript interfaces matching the backend, utility-first Tailwind styling directly in JSX, no abstractions "for later", and nothing from Section 10 ("Not doing").
* Decisions marked **(assumed)** were picked to keep things small; flip them before Phase 0 if you disagree.

---

## 2. Tech stack

* **React 18 + Vite + TypeScript** (`.ts` and `.tsx` with strict mode enabled).
* **Tailwind CSS** for styling (utility classes directly in components; zero custom CSS rules beyond the Tailwind directive entry in `index.css`).
* **React Router v6** (`react-router-dom`) for routing.
* **Native `fetch`** wrapped in a small typed helper (`api<T>`). No other runtime dependencies.
* **Config:** `VITE_API_URL` (e.g. `http://localhost:8000`). The backend already allows the Vite dev origin (`http://localhost:5173`) via `CORS_ORIGINS`, so no dev proxy is needed.
* **Deploy:** `npm run build` (`tsc -b && vite build`) produces a static site. Add its production origin to the backend's `CORS_ORIGINS`.
* **Devices:** Students will often be on phones. Every screen must work cleanly down to `360px` width using mobile-first Tailwind utilities.

---

## 3. Project structure (flat)

```text
frontend/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── .env.example                # VITE_API_URL=http://localhost:8000
├── public/
│   └── students-template.csv   # header: name,regno,dob + 2 sample rows
└── src/
    ├── main.tsx                # router + <AuthProvider>
    ├── index.css               # @import "tailwindcss"; (or @tailwind base/components/utilities)
    ├── types.ts                # all shared DTOs, JWT payload unions, and error shapes
    ├── api.ts                  # token helpers, JWT decode, typed fetch wrapper, error normalizer
    ├── auth.tsx                # AuthProvider, useAuth(), <RequireRole>
    ├── ui.tsx                  # useFetch<T>(path), <Header>, <ErrorBanner>, tiny shared bits
    ├── Login.tsx               # student/teacher tabs + admin variant
    ├── Student.tsx             # video list + player page
    ├── Teacher.tsx             # class progress matrix
    └── admin/
        ├── AdminLayout.tsx     # nav + <Outlet>
        ├── Schools.tsx
        ├── Classes.tsx
        ├── Videos.tsx
        ├── Subscriptions.tsx
        ├── Teachers.tsx
        └── Students.tsx
```

---

## 4. Routes and guards

| Path | Role | Screen |
|---|---|---|
| `/login` | public | Student / Teacher tabs |
| `/admin/login` | public | Admin login (not linked from anywhere) |
| `/student` | `student` | Video list |
| `/student/videos/:id` | `student` | Player |
| `/teacher` | `teacher` | Progress matrix |
| `/admin/schools` `classes` `videos` `subscriptions` `teachers` `students` | `admin` | Admin sections |
| `/` | any | Redirect to the role's home, or `/login` |

`RequireRole({ role: Role })`:
* No token, or `exp` passed: go to `/login` (`/admin/login` for admin routes).
* Wrong role: redirect to the user's own home (`/student`, `/teacher`, or `/admin/schools`). Never render a page and let the API `403`.

---

## 5. Auth, API client, and TypeScript contracts

* **Token storage: `sessionStorage` (assumed).** Schools use shared computers; closing the browser should log the student out. Cost: a new tab needs a new login. To flip, change one line in `api.ts`.
* **Identity comes from the JWT** (there is no `/me`): decode the payload client-side (base64url to `atob` to `JSON.parse`, no library) into a discriminated union (`JwtPayload` in `types.ts`):
  * `AdminJwt`: `{ role: "admin", user_id: string, school_id: null, class_id: null, full_name: string, username: string, exp: number }`
  * `TeacherJwt`: `{ role: "teacher", user_id: string, school_id: string, class_id: number, full_name: string, school_name: string, class_name: string, username: string, exp: number }`
  * `StudentJwt`: `{ role: "student", user_id: string, school_id: string, class_id: number, full_name: string, school_name: string, class_name: string, registration_number: string, exp: number }`
  * Decoding is for display and routing only; the backend enforces everything.
* **`api<T>(path: string, options?: ApiOptions): Promise<T>`** is the only place that calls `fetch`:
  * Adds `Authorization: Bearer <token>` when present.
  * Sends JSON (`body`) or `FormData` (`form` for the CSV upload, **without** setting `Content-Type` so the browser sets the multipart boundary).
  * Parses the response and throws a typed `ApiError` (`extends Error`) with `.message: string`, `.status: number`, and `.errors?: CsvRowError[]` (`{ row: number; problem: string }[]`).
* **401 handling:** On a **401 from a call that sent a token**, clear the token and go to the login page. A 401 from a login endpoint just means wrong credentials, so do not redirect.
* **403 never logs out:** On login it carries the subscription message; elsewhere it means wrong role (redirect home).
* **Error shapes: `detail` is not always a string.** The normalizer in `api.ts` must handle all of these safely with runtime type narrowing:

| Shape | Comes from | Show |
|---|---|---|
| `{ detail: "text" }` | DB handler / `HTTPException` (401, 403, 404, 409, 429, 503, 500, 400) | the text |
| `{ detail: [{ msg, loc, ... }] }` | Pydantic validation (bad date, `seats <= 0`, `end_date < start_date`, bad UUID) | join the `msg` values, strip the leading `"Value error, "` |
| `{ detail, errors: [{ row, problem }] }` | CSV 422 | `detail` plus a table of rows/problems (see Students) |
| `fetch` rejected (network down) | browser | `"Cannot reach the server. Check your connection."` |

* **Admin deletes:** The backend's 409 text on delete reads `"This record is linked to other data, or its subscription does not exist."`, which is confusing for a delete. For `DELETE` + `409`, override the message with: `"Remove the items that depend on this first (subscriptions, teachers, students; for a class also videos)."`

---

## 6. Screens

### Shared (`ui.tsx`)
* `Header`: App name, `full_name`, `school_name`, `class_name` (narrowed by `user.role`), and a **Logout** button (clears token, goes to login).
* `useFetch<T>(path: string | null)`: Returns `{ data: T | null, loading: boolean, error: string | null, reload: () => void }`. Passing `null` skips fetching (useful on Admin Students until a school is selected).
* `ErrorBanner`: Renders an accessible `<div role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">`.
* Buttons disable (`disabled:opacity-50`) while a mutation is pending.

### Login (`/login`, `/admin/login`)
* **Student tab:** School `<select>` (from `GET /api/schools`), registration number (`type="text"`, `.trim()`, never converted to a number because leading zeros like `"0042"` matter), DOB `<input type="date">` (already `YYYY-MM-DD`).
* **Teacher tab:** School `<select>`, username, password.
* **Admin page:** Username, password.
* Messages: `401` `"Invalid credentials"` as is; **`403` (inactive subscription) and `429` (too many attempts) shown clearly as returned**; no redirect on any of them.
* On success: store token, navigate to the role's home.

### Student (`/student`, `/student/videos/:id`)
* **List** (`GET /api/student/videos` typed as `StudentVideo[]`): Card per video with title, status badge (`not_started` / `in_progress` / `completed` rendered with **clear text + distinct Tailwind badge styles**, never colour alone), a Tailwind progress bar of `watch_duration_seconds / total_duration_seconds`, and the completion threshold (`"Complete at 85%"`). Empty list: `"No videos have been added for your class yet."`
* **Player page:** The page has no single-video endpoint, so it fetches `GET /api/student/videos` and finds the video by `id` (not found: message + back link). Plain `<video src controls className="w-full rounded bg-black">` (see assumption below). Heartbeat spec in Section 7. Show the live status badge from the last heartbeat response (the server decides `completed`).
* **(assumed) `video_url` is a direct file URL** (e.g. `.mp4` on a CDN, as in the guide's examples). YouTube/Vimeo links need an iframe player and are out of scope.

### Teacher (`/teacher`)
* `GET /api/teacher/dashboard` returns `TeacherDashboardRow[]`. **Pivot on the client:**
  * Unique students (`student_id`, `full_name`, `registration_number` in returned order) as rows.
  * Unique videos (`video_id`, `title`) as columns.
  * A `Map<string, TeacherDashboardRow>` keyed by `` `${student_id}:${video_id}` `` for cells.
* Cell: Status as text/badge plus watched time formatted as `m:ss` (`watch_duration_seconds`). Last column: `"completed n / total"` per student.
* **Empty state:** `[]` means 0 students **or** 0 videos (cross join): `"No students or videos assigned to this class yet."`
* **Known limit:** Rows do not include video duration, so no percentage is possible here. (A one-line backend change adding `v.total_duration_seconds` to the dashboard query would allow it; not planned.)
* The wide table scrolls inside an `overflow-x-auto` wrapper with the first column (student name + reg no) pinned via `sticky left-0 bg-white`.

### Admin (`/admin/*`)
`AdminLayout` is a responsive top/tab nav bar (`Schools`, `Classes`, `Videos`, `Subscriptions`, `Teachers`, `Students`) plus `<Outlet />`. Each page: one table + one create/upsert form, and calls `reload()` after every successful mutation (no local cache logic). Names, not raw UUIDs: load schools (`GET /api/schools`) and classes (`GET /api/admin/classes`) on pages that need selects or `school_name` / `class_name` lookup maps.

* **Schools:** List (`GET /api/schools`), create by name, delete.
* **Classes:** List, create with **manual integer `id`** + name, delete.
* **Videos:** List (class shown by name), create (class select, title, URL, **duration in seconds**, completion threshold `1` to `100`), delete. There is **no edit endpoint** for schools, classes, or videos: fix a mistake by delete + recreate. Delete confirm for a video must state that it **also deletes every student's progress for it**.
* **Subscriptions:** List, upsert form (school, class, `<input type="date">` start/end, `total_seats > 0`). One row per `(school_id, class_id)`; saving again updates it in place.
* **Teachers:** List, upsert form (school, class, full name, username, password `maxLength={72}`). **Only offer classes that already have a subscription for the chosen school** (derived by filtering `subscriptions` by `school_id`); this prevents the confusing FK `409`. Label the form `"Set / replace / reset the teacher of this class"` because `PUT` does all three. Delete.
* **Students:**
  * School `<select>` (required) and optional class filter; table shows registration number, name, class, DOB; delete one (confirm; cascades progress).
  * **CSV upload:** School, class, file input (`accept=".csv"`, pre-check `file.size <= 1_048_576`), link to `/students-template.csv`, note: `"Columns: name, regno, dob; dob as YYYY-MM-DD, DD-MM-YYYY or DD/MM/YYYY; keep regno as text."` On `200`, show `inserted` count in a green banner and refetch. On CSV `422`, render **all** `err.errors` as a row/problem table (row 1 is the header). On `400` (seat limit, no subscription) and `409` (duplicate regnos), show the message. Upload is all-or-nothing; state this near the button.
  * **Mass delete** (`"Delete all students in this class"`, requires both school and class selected): Confirm text must name the school and class, the student count (from the current list), and warn that it also deletes their video progress, cannot be undone, and **there is no export**. Show a standing amber callout box reminding admins to **promote the highest class first** (move Class 10 into 11 before Class 9 into 10) because registration numbers are unique across the whole school, and to keep each roster CSV before deleting.

---

## 7. Video heartbeat spec (the only tricky logic)

Use `useRef<number>` for mutable playback tracking (`watchRef` starting at `video.watch_duration_seconds`, and `lastTRef` starting at `null as number | null`) so `timeupdate` ticks do not trigger React re-renders on every frame, plus React state for the server-confirmed `{ status, watch_duration_seconds, last_position_seconds }`.

* **Resume:** On `loadedmetadata`, set `videoEl.currentTime = video.last_position_seconds`, **unless it is within 2 seconds of `video.total_duration_seconds`** (in which case start at `0`; otherwise a finished video would end instantly on replay).
* **Count watched time by media-time deltas**, not wall-clock and not raw `currentTime`:

```ts
const handleTimeUpdate = (e: React.SyntheticEvent<HTMLVideoElement>) => {
  const t = e.currentTarget.currentTime;
  if (lastTRef.current !== null) {
    const d = t - lastTRef.current;
    if (d > 0 && d < 3) {
      watchRef.current += d; // seeks are jumps, not watching
    }
  }
  lastTRef.current = t;
};

const handleSeeking = () => {
  lastTRef.current = null;
};
```

* **Send** `POST /api/student/videos/{id}/progress` with `{ watch_seconds: watchRef.current, position_seconds: videoEl.currentTime }` (floats are fine):
  * Every **15 s while playing** (interval started on `play`, cleared on `pause` / unmount),
  * On `pause`, on `ended`, and on unmount (route change).
* Take `status`, `watch_duration_seconds`, and `last_position_seconds` from the **response** (`ProgressResponse`) and update UI state; never compute completion on the client. Keep `watchRef.current = Math.max(watchRef.current, res.watch_duration_seconds)`.
* Heartbeat failures are **silent** (no alert per failed ping; next tick retries). A `401` still goes through the normal logout path in `api.ts`.
* **Accepted loss:** Closing the tab mid-play loses at most the last ~15 s of progress.

---

## 8. UI & Tailwind conventions

* **Clean, utilitarian palette:** Neutral slate/gray backgrounds (`bg-slate-50`, cards in `bg-white border border-slate-200 rounded-lg shadow-sm`), primary actions in `bg-blue-600 hover:bg-blue-700 text-white`, destructive actions in `text-red-600 hover:text-red-800` or `bg-red-600 text-white`.
* **Semantic HTML & Accessibility:** Explicit `<label htmlFor>` on every input, `<button type="button | submit">`, `<th scope="col | row">` on tables, and visible keyboard focus rings (`focus:outline-none focus:ring-2 focus:ring-blue-500`).
* **Confirmations:** Deletes use `window.confirm` (platform dialog, zero extra state); mass delete uses it too with the detailed warning string above. Upgrade to a styled `<dialog>` only if requested later.
* **Dates:** Shown as received (`YYYY-MM-DD`); the backend works in IST, so do no client timezone conversion.
* **Mobile-first layout:** Stack forms and cards in a single column on small screens (`grid-cols-1 sm:grid-cols-2`), wrap all data tables in `<div className="overflow-x-auto">`, and test every screen at `360px` viewport width.
* **Loading state:** Simple `"Loading..."` text is enough; no skeleton shimmer components.

---

## 9. Build roadmap (one phase at a time, wait for confirmation)

* **Phase 0, Scaffold:** Vite + React + TypeScript + Tailwind CSS setup, `types.ts` (all DTOs & JWT types), `api.ts` skeleton, router with placeholder pages, `.env.example`, `public/students-template.csv`.
  *Check:* `tsc --noEmit` passes and `GET /api/schools` from the browser works (proves CORS, Tailwind styling, and `VITE_API_URL`).
* **Phase 1, Auth:** Full `api.ts` (token storage, `decodeJwt`, typed `api<T>` wrapper, error normalizer), `auth.tsx`, `ui.tsx` (`Header`, `useFetch<T>`, `ErrorBanner`), `Login.tsx`, `RequireRole`, logout.
  *Check:* Student/teacher/admin can log in; wrong DOB five times shows the `429` message; expired subscription shows the `403` message; a student token opened on `/admin/schools` redirects home; refresh keeps the session; deleting the token or letting it expire returns to login.
* **Phase 2, Student:** `Student.tsx` (video list + player + heartbeat).
  *Check:* List matches the DB; video resumes where it stopped; status flips to `completed` at the threshold and stays `completed` after a rewatch; scrubbing forward does not inflate watch time; unknown video id shows a clear message; reopening after closing the tab resumes within ~15 s.
* **Phase 3, Teacher:** `Teacher.tsx` (dashboard matrix with client-side pivot and sticky student column).
  *Check:* Teacher sees only their own class; unstarted videos show `"not_started"`; empty class shows the empty state; matrix matches the DB and scrolls horizontally at `360px`.
* **Phase 4a, Admin catalog:** `AdminLayout.tsx`, `Schools.tsx`, `Classes.tsx`, `Videos.tsx`.
  *Check:* Duplicates show the `409` text; deleting an in-use class/school shows the dependency message; invalid threshold shows the Pydantic message as readable text (never `[object Object]`).
* **Phase 4b, Admin subscriptions and teachers:** `Subscriptions.tsx`, `Teachers.tsx`.
  *Check:* `end_date` before `start_date` shows a readable message; teacher form only lists subscribed classes for the chosen school; replacing a teacher and resetting a password both work.
* **Phase 4c, Admin students:** `Students.tsx` (list, single delete, CSV upload with row-error table, mass delete).
  *Check:* A CSV with several bad rows renders the table of all row problems with correct row numbers; over-seat upload shows seats remaining; duplicate regno shows the `409` list; mass delete shows the confirm text with the exact student count and the promote-highest-first callout.
* **Phase 5, Polish and ship:** `360px` responsive check on every screen, keyboard navigation check on forms, `npm run build` (`tsc -b && vite build` with zero type errors), set the production origin in backend `CORS_ORIGINS`, and run one full walkthrough across all three roles.

---

## 10. Not doing (on purpose, to keep it simple)

Redux/Zustand or any external state library (a typed auth context is enough), TanStack Query or SWR (refetch after mutation via `reload()`), external UI component kits (MUI, Chakra, Shadcn, Radix), toast/modal/form validation libraries (native HTML constraints + backend errors are enough), i18n, dark mode, charts, pagination, search or sorting in tables, edit-in-place for schools/classes/videos (no backend endpoint), roster export (no backend endpoint), password change or self-service reset screens, token refresh or expiry countdown, unload/`keepalive` heartbeat, auto-filling video duration from the file, a seat-usage widget, YouTube/iframe players, PWA/offline, analytics, automated test suites (rely on strict TypeScript checks and the per-phase manual checks; add Vitest for `decodeJwt`, the error normalizer, and the teacher matrix pivot only if bugs appear).

---

## 11. Things to know about the backend (no change required)

* The backend runs **one worker**; a restart clears login rate-limit counters.
* Subscription is checked **only at login**: an expired subscription does not stop a student whose 24 h token is still valid.
* If the `Authorization` header is missing entirely, older FastAPI versions answer `403 "Not authenticated"` instead of `401`. The route guards prevent this in normal use; verify in Phase 1 if you ever see it.
* Student `dob` is visible to admin only; never shown to teachers or other students.