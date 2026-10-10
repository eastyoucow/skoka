"""Unit tests for mask overlay rendering (no model)."""

from __future__ import annotations

import numpy as np
from PIL import Image

from inference.render import instance_color, render


def test_render_empty_masks_returns_rgb_copy(sample_rgb_image: Image.Image) -> None:
    out = render(sample_rgb_image, [])
    assert out.mode == "RGB"
    assert out.size == sample_rgb_image.size
    assert list(out.getdata()) == list(sample_rgb_image.getdata())


def test_render_applies_overlay_and_preserves_size(
    sample_rgb_image: Image.Image,
) -> None:
    mask = np.zeros((48, 64), dtype=np.uint8)
    mask[10:30, 10:40] = 255
    out = render(sample_rgb_image, [mask], alpha=120)
    assert out.size == sample_rgb_image.size
    assert out.mode == "RGB"
    # Pixel inside mask should differ from original.
    assert out.getpixel((20, 20)) != sample_rgb_image.getpixel((20, 20))
    # Pixel outside mask should match original (approximately; compositing).
    assert out.getpixel((2, 2)) == sample_rgb_image.getpixel((2, 2))


def test_render_resizes_mismatched_mask(sample_rgb_image: Image.Image) -> None:
    small = np.ones((12, 16), dtype=np.float32)
    out = render(sample_rgb_image, [small])
    assert out.size == sample_rgb_image.size


def test_render_multiple_instances_use_distinct_colors(
    sample_rgb_image: Image.Image,
) -> None:
    m0 = np.zeros((48, 64), dtype=np.uint8)
    m1 = np.zeros((48, 64), dtype=np.uint8)
    m0[5:15, 5:15] = 255
    m1[25:35, 25:35] = 255
    out = render(sample_rgb_image, [m0, m1], alpha=200)
    c0 = out.getpixel((10, 10))
    c1 = out.getpixel((30, 30))
    assert c0 != c1
    assert instance_color(0)[:3] != instance_color(1)[:3]


def test_render_with_contours_runs(sample_rgb_image: Image.Image) -> None:
    mask = np.zeros((48, 64), dtype=np.uint8)
    mask[8:40, 8:50] = 255
    out = render(sample_rgb_image, [mask], contours=True)
    assert out.size == sample_rgb_image.size
