/**
 * The one HTTP client for the whole site. It
 *  - sends cookies (the sign-in) and, if cookies are blocked, the fallback token (session.ts);
 *  - adds the anti-forgery (CSRF) token to every change, fetching a fresh one if it expired;
 *  - turns error responses into ApiError with a message a person can read, plus any per-field errors.
 */
import { authHeader, clearFallbackToken } from "./session";

export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001/api";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly fields?: Record<string, string>,
    public readonly problems?: string[]
  ) {
    super(message);
    this.name = "ApiError";
  }
}

let csrfToken: string | null = null;
async function csrf(): Promise<string> {
  if (csrfToken) return csrfToken;
  const response = await fetch(`${API_BASE}/auth/csrf`, { credentials: "include" });
  if (!response.ok) throw new ApiError("Couldn't reach the server. Check your connection and try again.", 0);
  csrfToken = ((await response.json()) as { token: string }).token;
  return csrfToken;
}

/** Listeners told when the server says the sign-in has ended (so the app can show the sign-in page). */
const unauthorizedListeners = new Set<() => void>();
export function onUnauthorized(listener: () => void): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

async function toError(response: Response): Promise<ApiError> {
  let body: { message?: string | string[]; code?: string; errors?: Record<string, string>; problems?: string[] } = {};
  try {
    body = await response.json();
  } catch {
    // not JSON
  }
  const raw = Array.isArray(body.message) ? body.message[0] : body.message;
  const fallback =
    response.status === 429 ? "Too many attempts. Please wait a minute and try again."
    : response.status >= 500 ? "Something went wrong on our side. Please try again in a moment."
    : response.status === 404 ? "Not found."
    : "That didn't work. Please check and try again.";
  return new ApiError(raw || fallback, response.status, body.code, body.errors, body.problems);
}

export interface RequestOptions {
  signal?: AbortSignal;
  /** Don't treat a 401 as "signed out" (used by the session checks themselves). */
  quiet401?: boolean;
}

export async function request<T>(method: string, path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
  const isForm = body instanceof FormData;
  const changes = method !== "GET" && method !== "HEAD";
  const send = async () => {
    const headers: Record<string, string> = { ...authHeader() };
    if (body !== undefined && !isForm) headers["Content-Type"] = "application/json";
    if (changes) headers["x-csrf-token"] = await csrf();
    return fetch(`${API_BASE}${path}`, {
      method,
      credentials: "include",
      headers,
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
      signal: options.signal,
    });
  };

  let response: Response;
  try {
    response = await send();
    // A CSRF token can expire while a phone tab sits in the background: get a new one and retry once.
    if (response.status === 403 && changes) {
      const text = await response.clone().text();
      if (/csrf/i.test(text)) {
        csrfToken = null;
        response = await send();
      }
    }
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    throw new ApiError("You seem to be offline. Check your connection and try again.", 0);
  }

  if (response.status === 401 && !options.quiet401) {
    clearFallbackToken();
    unauthorizedListeners.forEach((listener) => listener());
  }
  if (!response.ok) throw await toError(response);
  if (response.status === 204) return undefined as T;
  const type = response.headers.get("content-type") ?? "";
  return (type.includes("application/json") ? response.json() : response.text()) as Promise<T>;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>("GET", path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>("POST", path, body ?? {}, options),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};

/** Uploads one file; returns its address. `realm` picks where it may go (see the API's uploads controller). */
export async function uploadFile(file: File, realm: "staff" | "student" | "public" = "staff", isPrivate = false): Promise<{ url: string; filename: string; contentType: string }> {
  const form = new FormData();
  form.append("file", file);
  const path = realm === "student" ? "/me/uploads" : realm === "public" ? "/public/uploads" : `/uploads${isPrivate ? "?private=true" : ""}`;
  return request("POST", path, form);
}

/** Addresses returned by the API for stored files start with /api/…; make them absolute when the API lives elsewhere. */
export function mediaUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("/api/") && API_BASE.startsWith("http")) return API_BASE.replace(/\/api$/, "") + url;
  return url;
}

/** Downloads a CSV (or any file) from the API with the sign-in attached. */
export async function download(path: string, filename: string): Promise<void> {
  const response = await fetch(`${API_BASE}${path}`, { credentials: "include", headers: authHeader() });
  if (!response.ok) throw await toError(response);
  const blob = await response.blob();
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 5000);
}
