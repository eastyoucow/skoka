"""Unit tests for signed NestJS callback client (HTTP mocked)."""

from __future__ import annotations

import hashlib
import hmac
import json
from typing import Any

import httpx
import pytest

from inference.callback import (
    HEADER_SIGNATURE,
    HEADER_TIMESTAMP,
    CallbackClient,
    CallbackConfig,
    CallbackError,
    build_callback_url,
    sanitize_message,
    sign_payload,
)


def test_build_callback_url() -> None:
    assert (
        build_callback_url("https://api.example.com", "job-1", "complete")
        == "https://api.example.com/internal/jobs/job-1/complete"
    )
    assert (
        build_callback_url("https://api.example.com/", "job-1", "fail")
        == "https://api.example.com/internal/jobs/job-1/fail"
    )


def test_sign_payload_deterministic() -> None:
    body = b'{"a":1}'
    assert sign_payload("secret", "1700000000", body) == hmac.new(
        b"secret", b"1700000000." + body, hashlib.sha256
    ).hexdigest()


def test_sanitize_message_redacts_secretish() -> None:
    assert "omitted" in sanitize_message("bad token abc")
    assert sanitize_message("simple failure") == "simple failure"


def test_complete_sends_signed_headers_and_body() -> None:
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["headers"] = dict(request.headers)
        captured["body"] = request.content
        return httpx.Response(200, json={"ok": True})

    transport = httpx.MockTransport(handler)
    client = httpx.Client(transport=transport)
    cfg = CallbackConfig(shared_secret="test-secret", max_retries=1)

    with CallbackClient(
        "https://api.example.com", config=cfg, client=client
    ) as cb:
        cb.complete(
            job_id="job-1",
            attempt_id="attempt-1",
            count=3,
            output_key="jobs/job-1/attempts/attempt-1/result.png",
        )

    assert captured["url"].endswith("/internal/jobs/job-1/complete")
    body = json.loads(captured["body"])
    assert body == {
        "attemptId": "attempt-1",
        "count": 3,
        "outputKey": "jobs/job-1/attempts/attempt-1/result.png",
    }
    headers = {k.lower(): v for k, v in captured["headers"].items()}
    assert headers["authorization"] == "Bearer test-secret"
    ts = headers[HEADER_TIMESTAMP.lower()]
    sig = headers[HEADER_SIGNATURE.lower()]
    assert sig == sign_payload("test-secret", ts, captured["body"])


def test_fail_payload_shape() -> None:
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["body"] = json.loads(request.content)
        return httpx.Response(204)

    transport = httpx.MockTransport(handler)
    client = httpx.Client(transport=transport)
    cfg = CallbackConfig(shared_secret="s", max_retries=1)

    with CallbackClient("https://api.example.com", config=cfg, client=client) as cb:
        cb.fail(
            job_id="job-2",
            attempt_id="a-2",
            code="IMAGE_INVALID",
            message="bad image",
        )

    assert captured["url"].endswith("/internal/jobs/job-2/fail")
    assert captured["body"] == {
        "attemptId": "a-2",
        "code": "IMAGE_INVALID",
        "message": "bad image",
    }


def test_retries_on_5xx_then_succeeds() -> None:
    calls = {"n": 0}
    sleeps: list[float] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] < 3:
            return httpx.Response(503, text="busy")
        return httpx.Response(200)

    transport = httpx.MockTransport(handler)
    client = httpx.Client(transport=transport)
    cfg = CallbackConfig(
        shared_secret="s",
        max_retries=3,
        base_backoff_seconds=0.01,
    )

    with CallbackClient(
        "https://api.example.com",
        config=cfg,
        client=client,
        sleep=sleeps.append,
    ) as cb:
        cb.complete(
            job_id="j",
            attempt_id="a",
            count=0,
            output_key="k",
        )

    assert calls["n"] == 3
    assert len(sleeps) == 2


def test_no_retry_on_4xx() -> None:
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(401, text="nope")

    transport = httpx.MockTransport(handler)
    client = httpx.Client(transport=transport)
    cfg = CallbackConfig(shared_secret="s", max_retries=3)

    with CallbackClient(
        "https://api.example.com", config=cfg, client=client, sleep=lambda _: None
    ) as cb:
        with pytest.raises(CallbackError, match="rejected"):
            cb.complete(
                job_id="j", attempt_id="a", count=1, output_key="k"
            )

    assert calls["n"] == 1


def test_retries_on_429() -> None:
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(429, text="slow down")
        return httpx.Response(200)

    transport = httpx.MockTransport(handler)
    client = httpx.Client(transport=transport)
    cfg = CallbackConfig(shared_secret="s", max_retries=2, base_backoff_seconds=0)

    with CallbackClient(
        "https://api.example.com",
        config=cfg,
        client=client,
        sleep=lambda _: None,
    ) as cb:
        cb.fail(
            job_id="j",
            attempt_id="a",
            code="UNKNOWN",
            message="x",
        )

    assert calls["n"] == 2


def test_exhausted_retries_raise() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="fail")

    transport = httpx.MockTransport(handler)
    client = httpx.Client(transport=transport)
    cfg = CallbackConfig(shared_secret="s", max_retries=2, base_backoff_seconds=0)

    with CallbackClient(
        "https://api.example.com",
        config=cfg,
        client=client,
        sleep=lambda _: None,
    ) as cb:
        with pytest.raises(CallbackError, match="after 2"):
            cb.complete(
                job_id="j", attempt_id="a", count=1, output_key="k"
            )
