"""Unit tests for segment() with mocked SAM3 (no download)."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import numpy as np
import pytest
import torch
from PIL import Image

from inference.config import InferenceConfig
from inference.model import LoadedModel
from inference.segment import ImageLoadError, load_image, segment


def _fake_loaded(device: str = "cpu") -> LoadedModel:
    processor = MagicMock()
    model = MagicMock()

    original_sizes = torch.tensor([[48, 64]])
    processor.return_value = {
        "pixel_values": torch.zeros(1, 3, 32, 32),
        "original_sizes": original_sizes,
    }

    mask = torch.zeros(48, 64)
    mask[10:20, 10:20] = 1.0
    processor.post_process_instance_segmentation.return_value = [
        {
            "masks": [mask],
            "scores": [torch.tensor(0.9)],
            "boxes": [torch.tensor([10.0, 10.0, 20.0, 20.0])],
        }
    ]
    model.return_value = SimpleNamespace()

    return LoadedModel(
        model=model,
        processor=processor,
        device=torch.device(device),
        dtype=torch.float32,
        model_id="facebook/sam3",
    )


def test_load_image_from_path(fixture_image_path: Path) -> None:
    img = load_image(fixture_image_path)
    assert img.mode == "RGB"
    assert img.size == (32, 32)


def test_load_image_corrupt_raises(tmp_path: Path) -> None:
    bad = tmp_path / "bad.png"
    bad.write_bytes(b"not-an-image")
    with pytest.raises(ImageLoadError, match="Corrupt|unsupported|Failed"):
        load_image(bad)


def test_load_image_missing_raises(tmp_path: Path) -> None:
    with pytest.raises(ImageLoadError, match="not found"):
        load_image(tmp_path / "missing.jpg")


def test_segment_returns_count_and_masks(sample_rgb_image: Image.Image) -> None:
    loaded = _fake_loaded()
    cfg = InferenceConfig(device="cpu")
    result = segment(
        sample_rgb_image,
        "cat",
        config=cfg,
        loaded=loaded,
    )
    assert result.count == 1
    assert len(result.masks) == 1
    assert result.scores == pytest.approx([0.9])
    assert result.prompt == "cat"
    assert result.device == "cpu"
    loaded.processor.assert_called_once()
    loaded.model.assert_called_once()
    loaded.processor.post_process_instance_segmentation.assert_called_once()


def test_segment_zero_detections(sample_rgb_image: Image.Image) -> None:
    loaded = _fake_loaded()
    loaded.processor.post_process_instance_segmentation.return_value = [
        {"masks": [], "scores": [], "boxes": []}
    ]
    result = segment(sample_rgb_image, "unicorn", loaded=loaded)
    assert result.count == 0
    assert result.masks == []


def test_segment_empty_prompt_raises(sample_rgb_image: Image.Image) -> None:
    with pytest.raises(ValueError, match="prompt"):
        segment(sample_rgb_image, "  ", loaded=_fake_loaded())


def test_segment_passes_thresholds(sample_rgb_image: Image.Image) -> None:
    loaded = _fake_loaded()
    segment(
        sample_rgb_image,
        "person",
        loaded=loaded,
        score_threshold=0.4,
        mask_threshold=0.6,
    )
    kwargs = loaded.processor.post_process_instance_segmentation.call_args.kwargs
    assert kwargs["threshold"] == 0.4
    assert kwargs["mask_threshold"] == 0.6
