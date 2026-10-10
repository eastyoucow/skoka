"""Unit tests for R2 storage helpers (boto3 mocked)."""

from __future__ import annotations

from io import BytesIO
from unittest.mock import MagicMock

import pytest
from botocore.exceptions import ClientError

from inference.storage import (
    R2Config,
    StorageError,
    download_bytes,
    upload_bytes,
)


def _cfg() -> R2Config:
    return R2Config(
        account_id="acct",
        access_key_id="key",
        secret_access_key="secret",
        bucket="skoka-dev",
        endpoint="https://acct.r2.cloudflarestorage.com",
    )


def test_download_bytes_success() -> None:
    client = MagicMock()
    client.get_object.return_value = {"Body": BytesIO(b"image-bytes")}
    data = download_bytes("jobs/j/input.jpg", client=client, config=_cfg())
    assert data == b"image-bytes"
    client.get_object.assert_called_once_with(
        Bucket="skoka-dev", Key="jobs/j/input.jpg"
    )


def test_download_bytes_not_found() -> None:
    client = MagicMock()
    client.get_object.side_effect = ClientError(
        {"Error": {"Code": "NoSuchKey", "Message": "missing"}},
        "GetObject",
    )
    with pytest.raises(StorageError, match="not found"):
        download_bytes("missing", client=client, config=_cfg())


def test_upload_bytes_success() -> None:
    client = MagicMock()
    upload_bytes(
        "jobs/j/result.png",
        b"png",
        content_type="image/png",
        client=client,
        config=_cfg(),
    )
    client.put_object.assert_called_once_with(
        Bucket="skoka-dev",
        Key="jobs/j/result.png",
        Body=b"png",
        ContentType="image/png",
    )


def test_r2_config_derives_endpoint(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("R2_ACCOUNT_ID", "abc123")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "k")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "s")
    monkeypatch.setenv("R2_BUCKET", "bucket")
    # Empty string: load_env() may reload a local .env; keep endpoint unset.
    monkeypatch.setenv("R2_ENDPOINT", "")
    cfg = R2Config.from_env()
    assert cfg.endpoint == "https://abc123.r2.cloudflarestorage.com"
