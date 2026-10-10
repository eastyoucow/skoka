"""Render instance masks as semi-transparent overlays on an image."""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np
from PIL import Image, ImageFilter

# Distinct hues for overlapping instances (RGBA with alpha applied later).
_PALETTE: list[tuple[int, int, int]] = [
    (230, 25, 75),
    (60, 180, 75),
    (0, 130, 200),
    (245, 130, 48),
    (145, 30, 180),
    (70, 240, 240),
    (240, 50, 230),
    (210, 245, 60),
    (250, 190, 190),
    (0, 128, 128),
    (230, 190, 255),
    (170, 110, 40),
]


def _as_mask_array(mask: object, size: tuple[int, int]) -> np.ndarray:
    """Convert a mask tensor/array to a uint8 HxW array matching image size."""
    if hasattr(mask, "detach"):
        mask = mask.detach().cpu().numpy()
    arr = np.asarray(mask)
    if arr.ndim > 2:
        arr = np.squeeze(arr)
    if arr.ndim != 2:
        raise ValueError(f"Expected 2D mask, got shape {arr.shape}")

    if arr.dtype == np.bool_:
        arr_u8 = (arr.astype(np.uint8) * 255)
    elif np.issubdtype(arr.dtype, np.floating):
        arr_u8 = (np.clip(arr, 0.0, 1.0) * 255).astype(np.uint8)
    else:
        arr_u8 = arr.astype(np.uint8)
        if arr_u8.max() <= 1:
            arr_u8 = arr_u8 * 255

    height, width = size[1], size[0]
    if arr_u8.shape != (height, width):
        mask_img = Image.fromarray(arr_u8).resize(
            size, resample=Image.Resampling.NEAREST
        )
        arr_u8 = np.asarray(mask_img)
    return arr_u8


def instance_color(index: int, alpha: int = 100) -> tuple[int, int, int, int]:
    r, g, b = _PALETTE[index % len(_PALETTE)]
    return (r, g, b, alpha)


def render(
    image: Image.Image,
    masks: Sequence[object],
    *,
    alpha: int = 100,
    contours: bool = False,
    contour_width: int = 2,
) -> Image.Image:
    """
    Composite per-instance colored overlays onto ``image``.

    Empty ``masks`` returns an RGB copy of the input (no overlay).
    """
    if image.mode not in {"RGB", "RGBA"}:
        base = image.convert("RGBA")
    else:
        base = image.convert("RGBA")

    if not masks:
        return base.convert("RGB")

    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))

    for index, mask in enumerate(masks):
        mask_u8 = _as_mask_array(mask, base.size)
        mask_image = Image.fromarray(mask_u8)
        color = instance_color(index, alpha=alpha)
        color_layer = Image.new("RGBA", base.size, color)
        overlay.paste(color_layer, (0, 0), mask_image)

        if contours:
            # Approximate contour via dilated-minus-eroded binary mask.
            binary = mask_image.point(lambda p: 255 if p > 127 else 0)
            dilated = binary.filter(ImageFilter.MaxFilter(contour_width * 2 + 1))
            eroded = binary.filter(ImageFilter.MinFilter(contour_width * 2 + 1))
            edge = np.asarray(dilated, dtype=np.int16) - np.asarray(
                eroded, dtype=np.int16
            )
            edge_u8 = np.clip(edge, 0, 255).astype(np.uint8)
            if edge_u8.any():
                edge_img = Image.fromarray(edge_u8)
                outline = (*color[:3], 220)
                outline_layer = Image.new("RGBA", base.size, outline)
                overlay.paste(outline_layer, (0, 0), edge_img)

    composited = Image.alpha_composite(base, overlay)
    return composited.convert("RGB")
