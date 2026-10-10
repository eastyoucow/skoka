"""Lazy-loaded SAM3 model and processor cache."""

from __future__ import annotations

from dataclasses import dataclass

import torch
from transformers import Sam3Model, Sam3Processor

from inference.config import InferenceConfig, get_config
from inference.device import resolve_device
from inference.logging_util import log


@dataclass
class LoadedModel:
    model: Sam3Model
    processor: Sam3Processor
    device: torch.device
    dtype: torch.dtype
    model_id: str


_CACHE: LoadedModel | None = None


def clear_model_cache() -> None:
    """Drop the cached model (mainly for tests)."""
    global _CACHE
    _CACHE = None


def resolve_dtype(device: torch.device, preference: str = "auto") -> torch.dtype:
    """
    Pick a torch dtype for the model.

    ``auto``: float16 on CUDA/MPS (faster, less memory), float32 on CPU.
    """
    choice = (preference or "auto").strip().lower()
    mapping = {
        "float16": torch.float16,
        "fp16": torch.float16,
        "half": torch.float16,
        "float32": torch.float32,
        "fp32": torch.float32,
        "bfloat16": torch.bfloat16,
        "bf16": torch.bfloat16,
    }
    if choice == "auto":
        if device.type in {"cuda", "mps"}:
            return torch.float16
        return torch.float32
    if choice not in mapping:
        raise ValueError(
            f"Invalid SAM3_DTYPE={preference!r}; "
            "expected auto|float16|float32|bfloat16"
        )
    return mapping[choice]


def load_model(
    config: InferenceConfig | None = None,
    *,
    device_preference: str | None = None,
    force_reload: bool = False,
) -> LoadedModel:
    """
    Load and cache Sam3Model + Sam3Processor on the resolved device.
    """
    global _CACHE
    cfg = config or get_config()
    preference = device_preference or cfg.device
    device = resolve_device(preference)
    dtype = resolve_dtype(device, cfg.dtype)

    if (
        not force_reload
        and _CACHE is not None
        and _CACHE.model_id == cfg.model_id
        and _CACHE.device == device
        and _CACHE.dtype == dtype
    ):
        return _CACHE

    token = cfg.hf_token
    log(
        f"Loading {cfg.model_id} on {device} ({dtype}) — "
        "first download/load can take a few minutes"
    )
    model = Sam3Model.from_pretrained(
        cfg.model_id,
        token=token,
        dtype=dtype,
    )
    processor = Sam3Processor.from_pretrained(cfg.model_id, token=token)
    model.to(device)
    model.eval()
    log("Model ready")

    _CACHE = LoadedModel(
        model=model,
        processor=processor,
        device=device,
        dtype=dtype,
        model_id=cfg.model_id,
    )
    return _CACHE
