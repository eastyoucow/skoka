const SESSION_KEY = "skoka_session_token";
const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);

export type JobStatus =
  | "RECEIVED"
  | "QUEUED"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED";

export interface PublicJob {
  id: string;
  prompt: string;
  status: JobStatus;
  objectCount: number | null;
  deadlineAt: string | null;
  createdAt: string;
  updatedAt: string;
  created?: boolean;
}

export interface JobResult {
  status: JobStatus;
  objectCount: number | null;
  resultUrl: string;
  resultUrlExpiresAt: string;
  inputUrl?: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(SESSION_KEY);
}

function setStoredToken(token: string): void {
  sessionStorage.setItem(SESSION_KEY, token);
}

export function clearSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

async function ensureSession(): Promise<string> {
  const existing = getStoredToken();
  if (existing) return existing;

  const res = await fetch(`${API_URL}/web/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      (body as { message?: string }).message ?? "Failed to create session",
      res.status,
    );
  }
  const data = (await res.json()) as { token: string };
  setStoredToken(data.token);
  return data.token;
}

async function apiFetch<T>(
  path: string,
  init: RequestInit & { idempotencyKey?: string } = {},
): Promise<T> {
  const token = await ensureSession();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (init.idempotencyKey) {
    headers.set("Idempotency-Key", init.idempotencyKey);
  }

  const rest: RequestInit = { ...init };
  delete (rest as { idempotencyKey?: string }).idempotencyKey;
  const res = await fetch(`${API_URL}${path}`, { ...rest, headers });

  if (res.status === 401) {
    clearSession();
    const retryToken = await ensureSession();
    headers.set("Authorization", `Bearer ${retryToken}`);
    const retry = await fetch(`${API_URL}${path}`, { ...rest, headers });
    if (!retry.ok) {
      const body = await retry.json().catch(() => ({}));
      throw new ApiError(
        formatError(body, retry.status),
        retry.status,
      );
    }
    return retry.json() as Promise<T>;
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(formatError(body, res.status), res.status);
  }
  return res.json() as Promise<T>;
}

function formatError(body: unknown, status: number): string {
  if (body && typeof body === "object" && "message" in body) {
    const msg = (body as { message: string | string[] }).message;
    if (Array.isArray(msg)) return msg.join(", ");
    if (typeof msg === "string") return msg;
  }
  return `Request failed (${status})`;
}

export async function requestUpload(file: File): Promise<{
  uploadId: string;
  putUrl: string;
  headers: Record<string, string>;
}> {
  return apiFetch("/web/uploads", {
    method: "POST",
    body: JSON.stringify({
      contentType: file.type,
      contentLength: file.size,
    }),
  });
}

export async function putToR2(
  putUrl: string,
  file: File,
  headers: Record<string, string>,
): Promise<void> {
  const res = await fetch(putUrl, {
    method: "PUT",
    headers: {
      "Content-Type": headers["Content-Type"] ?? file.type,
    },
    body: file,
  });
  if (!res.ok) {
    throw new ApiError(`Direct upload failed (${res.status})`, res.status);
  }
}

export async function createJob(
  uploadId: string,
  prompt: string,
  idempotencyKey: string,
): Promise<PublicJob> {
  return apiFetch("/web/jobs", {
    method: "POST",
    body: JSON.stringify({ uploadId, prompt }),
    idempotencyKey,
  });
}

export async function getJob(jobId: string): Promise<PublicJob> {
  return apiFetch(`/web/jobs/${jobId}`);
}

export async function getJobResult(jobId: string): Promise<JobResult> {
  return apiFetch(`/web/jobs/${jobId}/result`);
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
