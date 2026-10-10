"""Text-prompted instance segmentation with SAM3."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import torch
from PIL import Image, UnidentifiedImageError

from inference.config import InferenceConfig, get_config
from inference.logging_util import log
from inference.model import LoadedModel, load_model


class ImageLoadError(ValueError):
    """Raised when an image cannot be opened or decoded."""


@dataclass(frozen=True)
class SegmentationResult:
    masks: list[Any]
    scores: list[float]
    boxes: list[Any]
    count: int
    prompt: str
    device: str
    model_id: str


def load_image(source: str | Path | Image.Image) -> Image.Image:
    """Load an RGB image from a path or pass through a PIL image."""
    if isinstance(source, Image.Image):
        return source.convert("RGB")

    path = Path(source)
    try:
        with Image.open(path) as img:
            img.load()
            return img.convert("RGB")
    except FileNotFoundError as exc:
        raise ImageLoadError(f"Image not found: {path}") from exc
    except UnidentifiedImageError as exc:
        raise ImageLoadError(f"Corrupt or unsupported image: {path}") from exc
    except OSError as exc:
        raise ImageLoadError(f"Failed to read image: {path}: {exc}") from exc


def _move_inputs_to_device(
    inputs: dict[str, Any], device: torch.device
) -> dict[str, Any]:
    """Move model tensors to device; keep size metadata on CPU."""
    moved: dict[str, Any] = {}
    for key, value in inputs.items():
        if key in {"original_sizes", "reshape_input_sizes"}:
            moved[key] = value
            continue
        if hasattr(value, "to"):
            moved[key] = value.to(device)
        else:
            moved[key] = value
    return moved


def segment(
    image: str | Path | Image.Image,
    prompt: str,
    *,
    config: InferenceConfig | None = None,
    loaded: LoadedModel | None = None,
    device_preference: str | None = None,
    score_threshold: float | None = None,
    mask_threshold: float | None = None,
) -> SegmentationResult:
    """
    Run SAM3 instance segmentation for ``prompt`` on ``image``.

    Returns masks, scores, boxes, and count after processor post-processing.
    """
    cfg = config or get_config()
    text = (prompt or "").strip()
    if not text:
        raise ValueError("prompt must be a non-empty string")

    pil_image = load_image(image)
    bundle = loaded or load_model(cfg, device_preference=device_preference)

    score_thr = (
        cfg.score_threshold if score_threshold is None else score_threshold
    )
    mask_thr = cfg.mask_threshold if mask_threshold is None else mask_threshold

    log(f"Preprocessing image {pil_image.size[0]}x{pil_image.size[1]} prompt={text!r}")
    inputs = bundle.processor(
        images=pil_image,
        text=text,
        return_tensors="pt",
    )
    inputs = _move_inputs_to_device(inputs, bundle.device)

    log(
        f"Running SAM3 forward on {bundle.device} — "
        "first MPS run can take several minutes (Metal kernel compile)"
    )
    with torch.inference_mode():
        outputs = bundle.model(**inputs)
        if bundle.device.type == "mps":
            torch.mps.synchronize()
    log("Forward done; post-processing masks")

    original_sizes = inputs["original_sizes"]
    if hasattr(original_sizes, "tolist"):
        target_sizes = original_sizes.tolist()
    else:
        target_sizes = list(original_sizes)

    results = bundle.processor.post_process_instance_segmentation(
        outputs,
        threshold=score_thr,
        mask_threshold=mask_thr,
        target_sizes=target_sizes,
    )[0]

    masks = list(results.get("masks", []))
    raw_scores = list(results.get("scores", []))
    boxes = list(results.get("boxes", []))

    scores: list[float] = []
    for score in raw_scores:
        if hasattr(score, "item"):
            scores.append(float(score.item()))
        else:
            scores.append(float(score))

    log(f"Detected count={len(masks)}")
    return SegmentationResult(
        masks=masks,
        scores=scores,
        boxes=boxes,
        count=len(masks),
        prompt=text,
        device=str(bundle.device),
        model_id=bundle.model_id,
    )
