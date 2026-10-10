"""Resolve the torch device for local and Modal inference."""

from __future__ import annotations

from typing import Literal

import torch

DeviceName = Literal["cuda", "mps", "cpu"]
DeviceChoice = Literal["auto", "cuda", "mps", "cpu"]


class DeviceError(RuntimeError):
    """Raised when a requested device is unavailable."""


def _mps_available() -> bool:
    backend = getattr(torch.backends, "mps", None)
    if backend is None:
        return False
    return bool(backend.is_available())


def resolve_device(preference: str = "auto") -> torch.device:
    """
    Resolve a torch.device.

    Preference ``auto`` uses CUDA → MPS → CPU.
    Explicit ``cuda`` / ``mps`` / ``cpu`` must be available (cpu always is).
    """
    choice = (preference or "auto").strip().lower()
    if choice not in {"auto", "cuda", "mps", "cpu"}:
        raise DeviceError(
            f"Invalid INFERENCE_DEVICE={preference!r}; "
            "expected auto|cuda|mps|cpu"
        )

    if choice == "cuda":
        if not torch.cuda.is_available():
            raise DeviceError("CUDA requested but not available")
        return torch.device("cuda")

    if choice == "mps":
        if not _mps_available():
            raise DeviceError("MPS requested but not available")
        return torch.device("mps")

    if choice == "cpu":
        return torch.device("cpu")

    # auto
    if torch.cuda.is_available():
        return torch.device("cuda")
    if _mps_available():
        return torch.device("mps")
    return torch.device("cpu")


def device_name(device: torch.device | str) -> DeviceName:
    name = torch.device(device).type
    if name not in {"cuda", "mps", "cpu"}:
        return "cpu"
    return name  # type: ignore[return-value]
