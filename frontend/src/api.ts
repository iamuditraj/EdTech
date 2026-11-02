import type { CsvRowError } from "./types";

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

// shortcut: minimal fetch for Phase 0 smoke check, upgrade to full token + error normalizer in Phase 1
export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
    let res: Response;
    try {
        res = await fetch(`${BASE_URL}${path}`, {
            method: options.method ?? "GET",
            headers: options.body ? { "Content-Type": "application/json" } : undefined,
            body: options.form ?? (options.body ? JSON.stringify(options.body) : undefined),
        });
    } catch {
        throw new ApiError("Cannot reach the server. Check your connection.", 0);
    }

    const data = await res.json().catch(() => null);
    if (!res.ok) {
        const msg = typeof data?.detail === "string" ? data.detail : `HTTP ${res.status}`;
        throw new ApiError(msg, res.status, data?.errors);
    }
    return data as T;
}