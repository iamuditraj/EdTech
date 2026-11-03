import type { CsvRowError, JwtPayload } from "./types";

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:8000";

export class ApiError extends Error {
    status: number;
    errors?: CsvRowError[];

    constructor(message: string, status: number, errors?: CsvRowError[]) {
        super(message);
        this.status = status;
        this.errors = errors;
    }
}

export interface ApiOptions {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    body?: unknown;
    form?: FormData;
}

// --- Token helpers (sessionStorage so closing browser logs out on shared computers) ---

export function getToken(): string | null {
    return sessionStorage.getItem("token");
}

export function setToken(token: string): void {
    sessionStorage.setItem("token", token);
}

export function clearToken(): void {
    sessionStorage.removeItem("token");
}

// --- JWT decode (no library) ---

function b64url(s: string): string {
    return s.replace(/-/g, "+").replace(/_/g, "/");
}

export function decodeJwt(token: string): JwtPayload | null {
    try {
        const payload = token.split(".")[1];
        if (!payload) return null;
        const json = atob(b64url(payload));
        return JSON.parse(json) as JwtPayload;
    } catch {
        return null;
    }
}

// --- Error normalizer ---

function normalizeError(status: number, data: unknown, method?: string): string {
    if (data == null || typeof data !== "object") return `HTTP ${status}`;
    const obj = data as Record<string, unknown>;

    // DELETE + 409: override confusing backend text
    if (method === "DELETE" && status === 409) {
        return "Remove the items that depend on this first (subscriptions, teachers, students; for a class also videos).";
    }

    const detail = obj.detail;

    // Pydantic array: { detail: [{ msg, ... }] }
    if (Array.isArray(detail)) {
        return detail
            .map((e: Record<string, unknown>) => {
                const msg = typeof e.msg === "string" ? e.msg : String(e);
                return msg.replace(/^Value error, /i, "");
            })
            .join("; ");
    }

    // Standard string detail
    if (typeof detail === "string") return detail;

    return `HTTP ${status}`;
}

// --- Typed fetch wrapper ---

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
    const token = getToken();
    const method = options.method ?? "GET";

    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    if (options.body) headers["Content-Type"] = "application/json";
    // For FormData (options.form), do NOT set Content-Type — browser sets multipart boundary

    let res: Response;
    try {
        res = await fetch(`${BASE_URL}${path}`, {
            method,
            headers,
            body: options.form ?? (options.body ? JSON.stringify(options.body) : undefined),
        });
    } catch {
        throw new ApiError("Cannot reach the server. Check your connection.", 0);
    }

    const data = await res.json().catch(() => null);

    if (!res.ok) {
        // 401 from a call that sent a token → clear auth (but not for login endpoints)
        if (res.status === 401 && token) {
            clearToken();
            window.location.href = path.includes("/admin") ? "/admin/login" : "/login";
            throw new ApiError("Session expired. Please log in again.", 401);
        }
        const msg = normalizeError(res.status, data, method);
        const csvErrors = (data as Record<string, unknown>)?.errors as CsvRowError[] | undefined;
        throw new ApiError(msg, res.status, csvErrors);
    }

    return data as T;
}
