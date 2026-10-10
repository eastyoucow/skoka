"""S3-compatible Cloudflare R2 read/write helpers."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

import boto3
from botocore.exceptions import ClientError

from inference.config import load_env
from inference.logging_util import log


class StorageError(RuntimeError):
    """Raised when an R2 object cannot be read or written."""


@dataclass(frozen=True)
class R2Config:
    account_id: str
    access_key_id: str
    secret_access_key: str
    bucket: str
    endpoint: str

    @classmethod
    def from_env(cls) -> R2Config:
        load_env()
        account_id = (os.getenv("R2_ACCOUNT_ID") or "").strip()
        access_key_id = (os.getenv("R2_ACCESS_KEY_ID") or "").strip()
        secret_access_key = (os.getenv("R2_SECRET_ACCESS_KEY") or "").strip()
        bucket = (os.getenv("R2_BUCKET") or "").strip()
        endpoint = (os.getenv("R2_ENDPOINT") or "").strip()
        if not endpoint and account_id:
            endpoint = f"https://{account_id}.r2.cloudflarestorage.com"
        missing = [
            name
            for name, value in (
                ("R2_ACCESS_KEY_ID", access_key_id),
                ("R2_SECRET_ACCESS_KEY", secret_access_key),
                ("R2_BUCKET", bucket),
                ("R2_ENDPOINT or R2_ACCOUNT_ID", endpoint),
            )
            if not value
        ]
        if missing:
            raise StorageError(
                "Missing R2 configuration: " + ", ".join(missing)
            )
        return cls(
            account_id=account_id,
            access_key_id=access_key_id,
            secret_access_key=secret_access_key,
            bucket=bucket,
            endpoint=endpoint,
        )


def create_s3_client(config: R2Config | None = None) -> Any:
    """Build a boto3 S3 client pointed at Cloudflare R2."""
    cfg = config or R2Config.from_env()
    return boto3.client(
        "s3",
        endpoint_url=cfg.endpoint,
        aws_access_key_id=cfg.access_key_id,
        aws_secret_access_key=cfg.secret_access_key,
        region_name="auto",
    )


def download_bytes(
    key: str,
    *,
    client: Any | None = None,
    config: R2Config | None = None,
) -> bytes:
    """Download an object by key. Raises StorageError if missing or on failure."""
    cfg = config or R2Config.from_env()
    s3 = client or create_s3_client(cfg)
    log(f"R2 download s3://{cfg.bucket}/{key}")
    try:
        response = s3.get_object(Bucket=cfg.bucket, Key=key)
        body = response["Body"].read()
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        if code in {"NoSuchKey", "404", "NotFound"}:
            raise StorageError(f"Object not found: {key}") from exc
        raise StorageError(f"Failed to download {key}: {code or exc}") from exc
    except Exception as exc:  # noqa: BLE001 — surface as StorageError
        raise StorageError(f"Failed to download {key}: {exc}") from exc
    if not body:
        raise StorageError(f"Empty object: {key}")
    return body


def upload_bytes(
    key: str,
    data: bytes,
    *,
    content_type: str = "application/octet-stream",
    client: Any | None = None,
    config: R2Config | None = None,
) -> None:
    """Upload bytes to R2 under ``key``."""
    cfg = config or R2Config.from_env()
    s3 = client or create_s3_client(cfg)
    log(f"R2 upload s3://{cfg.bucket}/{key} ({len(data)} bytes)")
    try:
        s3.put_object(
            Bucket=cfg.bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
        )
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        raise StorageError(f"Failed to upload {key}: {code or exc}") from exc
    except Exception as exc:  # noqa: BLE001
        raise StorageError(f"Failed to upload {key}: {exc}") from exc
