"""Unit tests for model dtype selection."""

from __future__ import annotations

import torch

from inference.model import resolve_dtype


def test_resolve_dtype_auto() -> None:
    assert resolve_dtype(torch.device("cpu"), "auto") == torch.float32
    assert resolve_dtype(torch.device("mps"), "auto") == torch.float16
    assert resolve_dtype(torch.device("cuda"), "auto") == torch.float16


def test_resolve_dtype_explicit() -> None:
    assert resolve_dtype(torch.device("cpu"), "float16") == torch.float16
    assert resolve_dtype(torch.device("mps"), "float32") == torch.float32
