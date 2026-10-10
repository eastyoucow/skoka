"""Authenticated NestJS job completion/failure callback client."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urljoin

import httpx

from inference.config import load_env
from inference.logging_util import log

# Stable failure codes for NestJS (do not invent free-form codes in the worker).
CODE_INPUT_NOT_FOUND = "INPUT_NOT_FOUND"
CODE_IMAGE_INVALID = "IMAGE_INVALID"
CODE_INFERENCE_ERROR = "INFERENCE_ERROR"
CODE_UPLOAD_FAILED = "UPLOAD_FAILED"
CODE_CALLBACK_FAILED = "CALLBACK_FAILED"
CODE_UNKNOWN = "UNKNOWN"

HEADER_TIMESTAMP = "X-Skoka-Timestamp"
HEADER_SIGNATURE = "X-Skoka-Signature"


class CallbackError(RuntimeError):
    """Raised when the callback cannot be delivered after retries."""


@dataclass(frozen=True)
class CallbackConfig:
    shared_secret: str
    timeout_seconds: float = 10.0
    max_retries: int = 3
    base_backoff_seconds: float = 0.5

    @classmethod
    def from_env(cls) -> CallbackConfig:
        load_env()
        secret = (os.getenv("CALLBACK_SHARED_SECRET") or "").strip()
        if not secret:
            raise CallbackError("CALLBACK_SHARED_SECRET is not set")
        timeout = float(os.getenv("CALLBACK_TIMEOUT_SECONDS", "10"))
        max_retries = int(os.getenv("CALLBACK_MAX_RETRIES", "3"))
        return cls(
            shared_secret=secret,
            timeout_seconds=timeout,
            max_retries=max(1, max_retries),
        )


def sanitize_message(message: str, *, max_length: int = 500) -> str:
    """Strip secrets-looking content and truncate for safe delivery."""
    text = " ".join((message or "").split())
    if not text:
        return "unknown error"
    # Avoid leaking env-style secrets in error text.
    lowered = text.lower()
    for needle in ("token", "secret", "password", "authorization", "access_key"):
        if needle in lowered:
            return "internal error (details omitted)"
    return text[:max_length]


def sign_payload(secret: str, timestamp: str, raw_body: bytes) -> str:
    """HMAC-SHA256 hex digest of ``timestamp + '.' + raw_body``."""
    message = timestamp.encode("utf-8") + b"." + raw_body
    return hmac.new(
        secret.encode("utf-8"), message, hashlib.sha256
    ).hexdigest()


def build_callback_url(callback_base_url: str, job_id: str, kind: str) -> str:
    """
    Build complete/fail URL from the NestJS base URL.

    ``callback_base_url`` is the API origin (e.g. https://api.example.com),
    not the full path. ``kind`` is ``complete`` or ``fail``.
    """
    if kind not in {"complete", "fail"}:
        raise ValueError(f"invalid callback kind: {kind}")
    base = callback_base_url.rstrip("/") + "/"
    path = f"internal/jobs/{job_id}/{kind}"
    return urljoin(base, path)


def _should_retry(status_code: int | None, exc: BaseException | None) -> bool:
    if exc is not None:
        return isinstance(
            exc,
            (
                httpx.TimeoutException,
                httpx.NetworkError,
                httpx.RemoteProtocolError,
            ),
        )
    if status_code is None:
        return False
    if status_code == 429:
        return True
    return 500 <= status_code <= 599


class CallbackClient:
    """
    POST signed completion/failure callbacks to NestJS.

    Delivery is at-least-once: callers (and this client) may retry. NestJS must
    accept only the active attemptId and treat duplicates as success without
    side effects.
    """

    def __init__(
        self,
        callback_base_url: str,
        *,
        config: CallbackConfig | None = None,
        client: httpx.Client | None = None,
        sleep: Any = time.sleep,
    ) -> None:
        self._base_url = callback_base_url.rstrip("/")
        self._config = config or CallbackConfig.from_env()
        self._owns_client = client is None
        self._client = client or httpx.Client(
            timeout=self._config.timeout_seconds
        )
        self._sleep = sleep

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def __enter__(self) -> CallbackClient:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()

    def complete(
        self,
        *,
        job_id: str,
        attempt_id: str,
        count: int,
        output_key: str,
    ) -> None:
        body = {
            "attemptId": attempt_id,
            "count": int(count),
            "outputKey": output_key,
        }
        self._post(job_id=job_id, kind="complete", body=body)

    def fail(
        self,
        *,
        job_id: str,
        attempt_id: str,
        code: str,
        message: str,
    ) -> None:
        body = {
            "attemptId": attempt_id,
            "code": code or CODE_UNKNOWN,
            "message": sanitize_message(message),
        }
        self._post(job_id=job_id, kind="fail", body=body)

    def _post(self, *, job_id: str, kind: str, body: dict[str, Any]) -> None:
        url = build_callback_url(self._base_url, job_id, kind)
        raw_body = json.dumps(body, separators=(",", ":"), sort_keys=True).encode(
            "utf-8"
        )
        last_error: str | None = None

        for attempt in range(1, self._config.max_retries + 1):
            timestamp = str(int(time.time()))
            signature = sign_payload(
                self._config.shared_secret, timestamp, raw_body
            )
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self._config.shared_secret}",
                HEADER_TIMESTAMP: timestamp,
                HEADER_SIGNATURE: signature,
            }
            log(
                f"Callback {kind} jobId={job_id} attempt={attempt}/"
                f"{self._config.max_retries}"
            )
            status_code: int | None = None
            exc: BaseException | None = None
            try:
                response = self._client.post(url, content=raw_body, headers=headers)
                status_code = response.status_code
                if 200 <= status_code < 300:
                    return
                last_error = f"HTTP {status_code}: {response.text[:200]}"
            except (
                httpx.TimeoutException,
                httpx.NetworkError,
                httpx.RemoteProtocolError,
            ) as err:
                exc = err
                last_error = f"{type(err).__name__}: {err}"

            if not _should_retry(status_code, exc):
                raise CallbackError(
                    f"Callback {kind} rejected for job {job_id}: {last_error}"
                )

            if attempt < self._config.max_retries:
                backoff = self._config.base_backoff_seconds * (2 ** (attempt - 1))
                self._sleep(backoff)

        raise CallbackError(
            f"Callback {kind} failed after {self._config.max_retries} "
            f"attempts for job {job_id}: {last_error}"
        )
