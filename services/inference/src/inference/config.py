"""Environment-backed configuration for the inference service."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

_SERVICE_ROOT = Path(__file__).resolve().parents[2]
_ENV_PATH = _SERVICE_ROOT / ".env"


def load_env(*, override: bool = False) -> None:
    """Load services/inference/.env if present."""
    if _ENV_PATH.is_file():
        load_dotenv(_ENV_PATH, override=override)


@dataclass(frozen=True)
class InferenceConfig:
    model_id: str = "facebook/sam3"
    device: str = "auto"
    dtype: str = "auto"
    score_threshold: float = 0.35
    mask_threshold: float = 0.5
    hf_token: str | None = None


def get_config() -> InferenceConfig:
    load_env()
    token = os.getenv("HF_TOKEN") or os.getenv("HUGGING_FACE_HUB_TOKEN")
    return InferenceConfig(
        model_id=os.getenv("SAM3_MODEL_ID", "facebook/sam3"),
        device=os.getenv("INFERENCE_DEVICE", "auto").strip().lower() or "auto",
        dtype=os.getenv("SAM3_DTYPE", "auto").strip().lower() or "auto",
        score_threshold=float(os.getenv("SAM3_SCORE_THRESHOLD", "0.35")),
        mask_threshold=float(os.getenv("SAM3_MASK_THRESHOLD", "0.5")),
        hf_token=token.strip() if token else None,
    )
