"""Orchestrate one inference attempt: R2 → SAM3 → R2 → callback."""

from __future__ import annotations

import io
from dataclasses import dataclass
from typing import Any

from PIL import Image

from inference.callback import (
    CODE_IMAGE_INVALID,
    CODE_INFERENCE_ERROR,
    CODE_INPUT_NOT_FOUND,
    CODE_UNKNOWN,
    CODE_UPLOAD_FAILED,
    CallbackClient,
    CallbackConfig,
    CallbackError,
)
from inference.logging_util import log
from inference.render import render
from inference.segment import ImageLoadError, segment
from inference.storage import R2Config, StorageError, download_bytes, upload_bytes


@dataclass(frozen=True)
class JobPayload:
    job_id: str
    attempt_id: str
    input_key: str
    prompt: str
    output_key: str
    callback_url: str

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> JobPayload:
        required = (
            "jobId",
            "attemptId",
            "inputKey",
            "prompt",
            "outputKey",
            "callbackUrl",
        )
        missing = [key for key in required if not data.get(key)]
        if missing:
            raise ValueError(f"Missing payload fields: {', '.join(missing)}")
        return cls(
            job_id=str(data["jobId"]),
            attempt_id=str(data["attemptId"]),
            input_key=str(data["inputKey"]),
            prompt=str(data["prompt"]),
            output_key=str(data["outputKey"]),
            callback_url=str(data["callbackUrl"]),
        )


@dataclass(frozen=True)
class JobResult:
    ok: bool
    count: int | None = None
    output_key: str | None = None
    error_code: str | None = None
    error_message: str | None = None


def run_job(
    payload: JobPayload | dict[str, Any],
    *,
    r2_config: R2Config | None = None,
    s3_client: Any | None = None,
    callback_config: CallbackConfig | None = None,
    http_client: Any | None = None,
    device_preference: str | None = "cuda",
) -> JobResult:
    """
    Execute one attempt end-to-end.

    Always attempts a success or failure callback when ``callback_url`` is set.
    Returns a structured result for Modal / local smoke without raising for
    expected inference failures (callback delivery errors still raise).
    """
    job = (
        payload
        if isinstance(payload, JobPayload)
        else JobPayload.from_dict(payload)
    )
    log(
        f"Job start jobId={job.job_id} attemptId={job.attempt_id} "
        f"prompt={job.prompt!r}"
    )

    try:
        raw = download_bytes(
            job.input_key, client=s3_client, config=r2_config
        )
        try:
            image = Image.open(io.BytesIO(raw))
            image.load()
            image = image.convert("RGB")
        except Exception as exc:  # noqa: BLE001 — map to IMAGE_INVALID
            raise ImageLoadError(f"Corrupt or unsupported image: {exc}") from exc

        result = segment(
            image,
            job.prompt,
            device_preference=device_preference,
        )
        overlay = render(image, result.masks)
        buffer = io.BytesIO()
        overlay.save(buffer, format="PNG")
        upload_bytes(
            job.output_key,
            buffer.getvalue(),
            content_type="image/png",
            client=s3_client,
            config=r2_config,
        )

        with CallbackClient(
            job.callback_url,
            config=callback_config,
            client=http_client,
        ) as cb:
            cb.complete(
                job_id=job.job_id,
                attempt_id=job.attempt_id,
                count=result.count,
                output_key=job.output_key,
            )

        log(f"Job complete jobId={job.job_id} count={result.count}")
        return JobResult(
            ok=True, count=result.count, output_key=job.output_key
        )

    except StorageError as exc:
        msg = str(exc).lower()
        if "not found" in msg or "empty object" in msg:
            code = CODE_INPUT_NOT_FOUND
        elif "upload" in msg:
            code = CODE_UPLOAD_FAILED
        else:
            code = CODE_UNKNOWN
        return _fail_job(
            job,
            code=code,
            message=str(exc),
            callback_config=callback_config,
            http_client=http_client,
        )
    except ImageLoadError as exc:
        return _fail_job(
            job,
            code=CODE_IMAGE_INVALID,
            message=str(exc),
            callback_config=callback_config,
            http_client=http_client,
        )
    except CallbackError:
        raise
    except Exception as exc:  # noqa: BLE001 — map unexpected to INFERENCE_ERROR
        return _fail_job(
            job,
            code=CODE_INFERENCE_ERROR,
            message=str(exc),
            callback_config=callback_config,
            http_client=http_client,
        )


def _fail_job(
    job: JobPayload,
    *,
    code: str,
    message: str,
    callback_config: CallbackConfig | None,
    http_client: Any | None,
) -> JobResult:
    log(f"Job fail jobId={job.job_id} code={code}: {message}")
    with CallbackClient(
        job.callback_url,
        config=callback_config,
        client=http_client,
    ) as cb:
        cb.fail(
            job_id=job.job_id,
            attempt_id=job.attempt_id,
            code=code,
            message=message,
        )
    return JobResult(ok=False, error_code=code, error_message=message)
