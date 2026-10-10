"""Optional real-model integration test (skipped by default)."""

from __future__ import annotations

import platform
import time
from pathlib import Path

import pytest
from PIL import Image

from inference.render import render
from inference.segment import segment

pytestmark = pytest.mark.integration

FIXTURES = Path(__file__).parent / "fixtures"


def _ensure_fixture_image() -> Path:
    path = FIXTURES / "synthetic_persons.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.is_file():
        # Deterministic synthetic scene — not a user photo.
        img = Image.new("RGB", (256, 256), color=(240, 240, 240))
        for box, color in (
            ((40, 40, 100, 160), (30, 30, 30)),
            ((140, 50, 200, 170), (50, 50, 50)),
        ):
            patch = Image.new(
                "RGB", (box[2] - box[0], box[3] - box[1]), color
            )
            img.paste(patch, (box[0], box[1]))
        img.save(path)
    return path


def _rss_mb() -> float | None:
    try:
        import resource

        raw = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        # Linux: kilobytes; macOS: bytes
        if platform.system() == "Darwin":
            return round(raw / (1024 * 1024), 1)
        return round(raw / 1024, 1)
    except Exception:  # noqa: BLE001
        return None


@pytest.fixture(scope="module")
def integration_image() -> Path:
    return _ensure_fixture_image()


def test_real_sam3_segment_and_render(
    require_integration: str,
    integration_image: Path,
    tmp_path_factory: pytest.TempPathFactory,
) -> None:
    out_dir = tmp_path_factory.mktemp("integration")
    out_path = out_dir / "result.png"

    started = time.perf_counter()
    result = segment(integration_image, "person")
    image = Image.open(integration_image).convert("RGB")
    overlay = render(image, result.masks)
    overlay.save(out_path)
    elapsed = time.perf_counter() - started

    assert result.count == len(result.masks)
    assert out_path.is_file()
    assert overlay.size[0] > 0

    print(
        f"[integration] {require_integration} count={result.count} "
        f"device={result.device} elapsed_s={elapsed:.2f} rss_mb≈{_rss_mb()}"
    )
