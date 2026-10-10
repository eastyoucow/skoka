"""Unit tests for job orchestration with mocked R2, SAM3, and HTTP."""

from __future__ import annotations

import io
from typing import Any
from unittest.mock import MagicMock, patch

import httpx
import pytest
from PIL import Image

from inference.callback import CallbackConfig
from inference.job import JobPayload, run_job
from inference.segment import SegmentationResult
from inference.storage import R2Config, StorageError


def _r2() -> R2Config:
    return R2Config(
        account_id="a",
        access_key_id="k",
        secret_access_key="s",
        bucket="b",
        endpoint="https://a.r2.cloudflarestorage.com",
    )


def _payload(**overrides: Any) -> dict[str, Any]:
    base = {
        "jobId": "job-1",
        "attemptId": "attempt-1",
        "inputKey": "jobs/job-1/input.jpg",
        "prompt": "person",
        "outputKey": "jobs/job-1/attempts/attempt-1/result.png",
        "callbackUrl": "https://api.example.com",
    }
    base.update(overrides)
    return base


def _png_bytes() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (16, 16), color=(10, 20, 30)).save(buf, format="PNG")
    return buf.getvalue()


def test_run_job_success_calls_complete() -> None:
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200)

    http = httpx.Client(transport=httpx.MockTransport(handler))
    s3 = MagicMock()
    fake_result = SegmentationResult(
        masks=[],
        scores=[],
        boxes=[],
        count=0,
        prompt="person",
        device="cpu",
        model_id="facebook/sam3",
    )

    with (
        patch("inference.job.download_bytes", return_value=_png_bytes()),
        patch("inference.job.segment", return_value=fake_result) as seg,
        patch("inference.job.render", return_value=Image.new("RGB", (16, 16))),
        patch("inference.job.upload_bytes") as upload,
    ):
        result = run_job(
            _payload(),
            r2_config=_r2(),
            s3_client=s3,
            callback_config=CallbackConfig(shared_secret="sec", max_retries=1),
            http_client=http,
            device_preference="cpu",
        )

    assert result.ok is True
    assert result.count == 0
    seg.assert_called_once()
    upload.assert_called_once()
    assert len(captured) == 1
    assert captured[0].url.path.endswith("/complete")


def test_run_job_input_missing_calls_fail() -> None:
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200)

    http = httpx.Client(transport=httpx.MockTransport(handler))

    with patch(
        "inference.job.download_bytes",
        side_effect=StorageError("Object not found: x"),
    ):
        result = run_job(
            _payload(),
            r2_config=_r2(),
            callback_config=CallbackConfig(shared_secret="sec", max_retries=1),
            http_client=http,
            device_preference="cpu",
        )

    assert result.ok is False
    assert result.error_code == "INPUT_NOT_FOUND"
    assert len(captured) == 1
    assert captured[0].url.path.endswith("/fail")


def test_job_payload_requires_fields() -> None:
    with pytest.raises(ValueError, match="Missing"):
        JobPayload.from_dict({"jobId": "x"})


def test_duplicate_complete_callbacks_are_client_retries() -> None:
    """Client may POST complete more than once; NestJS must be idempotent."""
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(503)
        return httpx.Response(200)

    http = httpx.Client(transport=httpx.MockTransport(handler))
    fake_result = SegmentationResult(
        masks=[],
        scores=[],
        boxes=[],
        count=2,
        prompt="person",
        device="cpu",
        model_id="facebook/sam3",
    )

    with (
        patch("inference.job.download_bytes", return_value=_png_bytes()),
        patch("inference.job.segment", return_value=fake_result),
        patch("inference.job.render", return_value=Image.new("RGB", (16, 16))),
        patch("inference.job.upload_bytes"),
    ):
        result = run_job(
            _payload(),
            r2_config=_r2(),
            callback_config=CallbackConfig(
                shared_secret="sec",
                max_retries=3,
                base_backoff_seconds=0,
            ),
            http_client=http,
            device_preference="cpu",
        )

    assert result.ok is True
    assert calls["n"] == 2
