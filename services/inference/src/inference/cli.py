"""CLI: segment an image and write an overlay PNG/JPEG."""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from inference.config import get_config, load_env
from inference.logging_util import log
from inference.render import render
from inference.segment import ImageLoadError, load_image, segment


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m inference",
        description="Run SAM3 segmentation and write a masked overlay image.",
    )
    parser.add_argument("--image", required=True, help="Path to input image")
    parser.add_argument(
        "--prompt",
        required=True,
        help="Text label to count (e.g. person, cat)",
    )
    parser.add_argument(
        "--output",
        required=True,
        help="Path for output overlay image (png/jpeg)",
    )
    parser.add_argument(
        "--device",
        default=None,
        help="Override INFERENCE_DEVICE for this run (auto|cuda|mps|cpu)",
    )
    parser.add_argument(
        "--contours",
        action="store_true",
        help="Draw approximate contours around instance masks",
    )
    parser.add_argument(
        "--score-threshold",
        type=float,
        default=None,
        help="Override SAM3 score threshold (default from env/config)",
    )
    parser.add_argument(
        "--mask-threshold",
        type=float,
        default=None,
        help="Override SAM3 mask threshold (default from env/config)",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    load_env()
    args = build_parser().parse_args(argv)
    cfg = get_config()
    device_preference = args.device or cfg.device

    input_path = Path(args.image)
    output_path = Path(args.output)

    try:
        image = load_image(input_path)
    except ImageLoadError as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        return 2

    log(
        f"Starting job image={input_path} size={image.size[0]}x{image.size[1]} "
        f"device_pref={device_preference}"
    )
    started = time.perf_counter()
    try:
        result = segment(
            image,
            args.prompt,
            config=cfg,
            device_preference=device_preference,
            score_threshold=args.score_threshold,
            mask_threshold=args.mask_threshold,
        )
    except Exception as exc:  # noqa: BLE001 — surface as CLI error JSON
        print(
            json.dumps({"error": f"{type(exc).__name__}: {exc}"}),
            file=sys.stderr,
        )
        return 1

    log("Rendering overlay")
    overlay = render(image, result.masks, contours=args.contours)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    overlay.save(output_path)
    elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
    log(f"Wrote {output_path} in {elapsed_ms} ms")

    payload = {
        "count": result.count,
        "prompt": result.prompt,
        "device": result.device,
        "model_id": result.model_id,
        "scores": result.scores,
        "output": str(output_path),
        "elapsed_ms": elapsed_ms,
    }
    print(json.dumps(payload))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
