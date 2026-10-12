"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ALLOWED_TYPES,
  ApiError,
  createJob,
  getJob,
  getJobResult,
  MAX_UPLOAD_BYTES,
  newIdempotencyKey,
  putToR2,
  requestUpload,
  type JobResult,
  type PublicJob,
} from "@/lib/api";
import { cn } from "@/lib/utils";

type Step = "idle" | "submitting" | "processing" | "done" | "error";

const POLL_MS = 2000;
const CLIENT_TIMEOUT_MS = 5 * 60 * 1000;

function statusLabel(status: string): string {
  switch (status) {
    case "RECEIVED":
    case "QUEUED":
      return "Queued — waiting for a GPU worker";
    case "PROCESSING":
      return "Running detection";
    case "COMPLETED":
      return "Done";
    case "FAILED":
      return "Processing failed";
    default:
      return status;
  }
}

export function DemoApp() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("person");
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<PublicJob | null>(null);
  const [result, setResult] = useState<JobResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number>(0);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [previewUrl]);

  const reset = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null);
    setPreviewUrl(null);
    setPrompt("person");
    setStep("idle");
    setError(null);
    setJob(null);
    setResult(null);
  }, [previewUrl]);

  const selectFile = (next: File | null) => {
    setError(null);
    if (!next) return;
    if (!ALLOWED_TYPES.includes(next.type)) {
      setError("Use JPEG, PNG, or WebP.");
      return;
    }
    if (next.size > MAX_UPLOAD_BYTES) {
      setError("Image must be under 10 MB.");
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(next);
    setPreviewUrl(URL.createObjectURL(next));
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) selectFile(dropped);
  };

  const stopPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  };

  const finishWithResult = async (jobId: string) => {
    const res = await getJobResult(jobId);
    setResult(res);
    setStep("done");
  };

  const startPolling = (jobId: string) => {
    stopPolling();
    startedAtRef.current = Date.now();
    setStep("processing");

    const tick = async () => {
      try {
        if (Date.now() - startedAtRef.current > CLIENT_TIMEOUT_MS) {
          stopPolling();
          setError("Timed out waiting for a result. Try again.");
          setStep("error");
          return;
        }
        const current = await getJob(jobId);
        setJob(current);
        if (current.status === "COMPLETED") {
          stopPolling();
          await finishWithResult(jobId);
          return;
        }
        if (current.status === "FAILED") {
          stopPolling();
          setError("Detection failed. Try another photo or prompt.");
          setStep("error");
        }
      } catch (err) {
        stopPolling();
        setError(err instanceof Error ? err.message : "Polling failed");
        setStep("error");
      }
    };

    void tick();
    pollRef.current = setInterval(() => void tick(), POLL_MS);
  };

  const submit = async () => {
    if (!file || step === "submitting" || step === "processing") return;
    setError(null);
    setStep("submitting");
    const idempotencyKey = newIdempotencyKey();

    try {
      const upload = await requestUpload(file);
      await putToR2(upload.putUrl, file, upload.headers);
      const created = await createJob(
        upload.uploadId,
        prompt.trim() || "person",
        idempotencyKey,
      );
      setJob(created);
      if (created.status === "COMPLETED") {
        await finishWithResult(created.id);
        return;
      }
      if (created.status === "FAILED") {
        setError("Detection failed. Try another photo or prompt.");
        setStep("error");
        return;
      }
      startPolling(created.id);
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Something went wrong";
      setError(message);
      setStep("error");
    }
  };

  const busy = step === "submitting" || step === "processing";

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-5 pb-16 pt-10 sm:px-8 sm:pt-16">
      <header className="animate-fade-up mb-10 sm:mb-14">
        <p className="font-display text-4xl font-extrabold tracking-tight text-[var(--fg)] sm:text-5xl">
          Skoka
        </p>
        <h1 className="mt-3 max-w-xl text-lg font-medium text-[var(--fg)] sm:text-xl">
          Count objects in a photo
        </h1>
        <p className="mt-2 max-w-lg text-[var(--fg-muted)]">
          Upload an image, name what to find, and get a masked result with a
          count. Public demo — no account.
        </p>
      </header>

      <main className="animate-fade-up flex flex-1 flex-col gap-8 [animation-delay:80ms]">
        {(step === "idle" || step === "error" || step === "submitting") && (
          <section className="flex flex-col gap-6">
            <div
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
              className={cn(
                "relative flex min-h-[220px] cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border border-dashed border-[var(--border)] bg-[var(--bg-elevated)]/60 px-4 py-10 transition",
                dragOver && "border-[var(--accent)] bg-[var(--accent-dim)]",
                previewUrl && "border-solid p-0",
              )}
            >
              <input
                ref={inputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => selectFile(e.target.files?.[0] ?? null)}
              />
              {previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewUrl}
                  alt="Selected upload preview"
                  className="max-h-[360px] w-full object-contain"
                />
              ) : (
                <>
                  <p className="text-base font-medium text-[var(--fg)]">
                    Drop an image here
                  </p>
                  <p className="mt-1 text-sm text-[var(--fg-muted)]">
                    or click to browse · JPEG / PNG / WebP · max 10 MB
                  </p>
                </>
              )}
            </div>

            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-[var(--fg-muted)]">
                What to count
              </span>
              <input
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={busy}
                maxLength={64}
                placeholder="person, car, dog…"
                className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-3 text-[var(--fg)] outline-none transition placeholder:text-[var(--fg-muted)]/60 focus:border-[var(--accent)]"
              />
            </label>

            {error && (
              <p className="rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-4 py-3 text-sm text-[var(--danger)]">
                {error}
              </p>
            )}

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={!file || busy || !prompt.trim()}
                onClick={() => void submit()}
                className="rounded-xl bg-[var(--accent)] px-6 py-3 text-sm font-semibold text-[#042f2e] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {step === "submitting" ? "Uploading…" : "Count objects"}
              </button>
              {(file || error) && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={reset}
                  className="rounded-xl border border-[var(--border)] px-5 py-3 text-sm font-medium text-[var(--fg-muted)] transition hover:border-[var(--fg-muted)] hover:text-[var(--fg)] disabled:opacity-40"
                >
                  Reset
                </button>
              )}
            </div>
          </section>
        )}

        {step === "processing" && job && (
          <section className="flex flex-col items-start gap-5 animate-fade-up">
            <div className="animate-pulse-ring flex h-14 w-14 items-center justify-center rounded-full border border-[var(--accent)]/40 bg-[var(--accent-dim)]">
              <span className="h-3 w-3 rounded-full bg-[var(--accent)]" />
            </div>
            <div>
              <p className="font-display text-2xl font-bold tracking-tight">
                Working…
              </p>
              <p className="mt-2 text-[var(--fg-muted)]">
                {statusLabel(job.status)}
              </p>
              <p className="mt-1 text-sm text-[var(--fg-muted)]/80">
                Prompt: {job.prompt}
              </p>
            </div>
            {previewUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt="Input while processing"
                className="mt-2 max-h-48 rounded-xl opacity-70"
              />
            )}
          </section>
        )}

        {step === "done" && result && (
          <section className="flex flex-col gap-6 animate-fade-up">
            <div>
              <p className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
                {result.objectCount ?? 0}{" "}
                <span className="text-[var(--accent)]">
                  {(result.objectCount ?? 0) === 1 ? "match" : "matches"}
                </span>
              </p>
              <p className="mt-2 text-[var(--fg-muted)]">
                Annotated result for “{job?.prompt ?? prompt}”
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {result.inputUrl && (
                <figure className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)]/50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={result.inputUrl}
                    alt="Original"
                    className="w-full object-contain"
                  />
                  <figcaption className="px-3 py-2 text-xs text-[var(--fg-muted)]">
                    Original
                  </figcaption>
                </figure>
              )}
              <figure className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)]/50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={result.resultUrl}
                  alt="Annotated result"
                  className="w-full object-contain"
                />
                <figcaption className="px-3 py-2 text-xs text-[var(--fg-muted)]">
                  Result
                </figcaption>
              </figure>
            </div>

            <div className="flex flex-wrap gap-3">
              <a
                href={result.resultUrl}
                download="skoka-result.png"
                target="_blank"
                rel="noreferrer"
                className="rounded-xl bg-[var(--accent)] px-6 py-3 text-sm font-semibold text-[#042f2e] transition hover:brightness-110"
              >
                Download result
              </a>
              <button
                type="button"
                onClick={reset}
                className="rounded-xl border border-[var(--border)] px-5 py-3 text-sm font-medium text-[var(--fg-muted)] transition hover:border-[var(--fg-muted)] hover:text-[var(--fg)]"
              >
                Try another
              </button>
            </div>
          </section>
        )}
      </main>

      <footer className="mt-16 text-xs text-[var(--fg-muted)]/70">
        Temporary images · no accounts · powered by SAM3
      </footer>
    </div>
  );
}
