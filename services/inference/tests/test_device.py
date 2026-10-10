"""Unit tests for device resolution (mocked torch backends)."""

from __future__ import annotations

from unittest.mock import patch

import pytest

from inference.device import DeviceError, device_name, resolve_device


def test_auto_prefers_cuda() -> None:
    with (
        patch("inference.device.torch.cuda.is_available", return_value=True),
        patch("inference.device._mps_available", return_value=True),
    ):
        device = resolve_device("auto")
    assert device.type == "cuda"


def test_auto_falls_back_to_mps() -> None:
    with (
        patch("inference.device.torch.cuda.is_available", return_value=False),
        patch("inference.device._mps_available", return_value=True),
    ):
        device = resolve_device("auto")
    assert device.type == "mps"


def test_auto_falls_back_to_cpu() -> None:
    with (
        patch("inference.device.torch.cuda.is_available", return_value=False),
        patch("inference.device._mps_available", return_value=False),
    ):
        device = resolve_device("auto")
    assert device.type == "cpu"


def test_explicit_cuda_unavailable_raises() -> None:
    with patch("inference.device.torch.cuda.is_available", return_value=False):
        with pytest.raises(DeviceError, match="CUDA"):
            resolve_device("cuda")


def test_explicit_mps_unavailable_raises() -> None:
    with patch("inference.device._mps_available", return_value=False):
        with pytest.raises(DeviceError, match="MPS"):
            resolve_device("mps")


def test_explicit_cpu_always_works() -> None:
    device = resolve_device("cpu")
    assert device.type == "cpu"


def test_invalid_preference_raises() -> None:
    with pytest.raises(DeviceError, match="Invalid"):
        resolve_device("tpu")


def test_device_name() -> None:
    assert device_name("cpu") == "cpu"
    assert device_name(resolve_device("cpu")) == "cpu"
