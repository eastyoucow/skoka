"""Shared pytest fixtures and integration skip helpers."""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from PIL import Image

from inference.config import load_env
from inference.device import DeviceError, resolve_device

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def sample_rgb_image() -> Image.Image:
    """Simple synthetic RGB image for unit tests."""
    img = Image.new("RGB", (64, 48), color=(40, 80, 120))
    return img


@pytest.fixture
def fixture_image_path(tmp_path: Path) -> Path:
    """Write a tiny PNG under tmp for path-based load tests."""
    path = tmp_path / "tiny.png"
    Image.new("RGB", (32, 32), color=(200, 100, 50)).save(path)
    return path


def integration_ready() -> tuple[bool, str]:
    """
    Return (ok, reason) for real-model integration tests.

    Requires HF_TOKEN (or HUGGING_FACE_HUB_TOKEN), INFERENCE_RUN_INTEGRATION=1,
    and a resolvable device (CUDA/MPS preferred; CPU allowed if explicitly set).
    """
    load_env()
    if os.getenv("INFERENCE_RUN_INTEGRATION", "").strip() not in {
        "1",
        "true",
        "yes",
    }:
        return False, "set INFERENCE_RUN_INTEGRATION=1 to enable"

    token = os.getenv("HF_TOKEN") or os.getenv("HUGGING_FACE_HUB_TOKEN")
    if not token:
        return False, "HF_TOKEN not set"

    preference = os.getenv("INFERENCE_DEVICE", "auto").strip().lower() or "auto"
    try:
        device = resolve_device(preference)
    except DeviceError as exc:
        return False, str(exc)

    # Allow CPU only when explicitly requested; auto on CPU-only hosts skips.
    if device.type == "cpu" and preference == "auto":
        return False, "no CUDA/MPS available (set INFERENCE_DEVICE=cpu to force)"

    return True, f"device={device}"


@pytest.fixture
def require_integration() -> str:
    """Skip the test unless integration prerequisites are met."""
    ok, reason = integration_ready()
    if not ok:
        pytest.skip(reason)
    return reason


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line(
        "markers",
        "integration: real SAM3 model; requires HF_TOKEN and a usable device",
    )
