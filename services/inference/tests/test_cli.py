"""CLI unit tests with mocked segment/render."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from inference.cli import main
from inference.segment import SegmentationResult


def test_cli_writes_output_and_prints_json(
    tmp_path: Path, sample_rgb_image: Image.Image
) -> None:
    image_path = tmp_path / "in.png"
    output_path = tmp_path / "out.png"
    sample_rgb_image.save(image_path)

    fake_result = SegmentationResult(
        masks=[],
        scores=[],
        boxes=[],
        count=0,
        prompt="person",
        device="cpu",
        model_id="facebook/sam3",
    )

    with (
        patch("inference.cli.segment", return_value=fake_result) as seg,
        patch(
            "inference.cli.render",
            return_value=sample_rgb_image.copy(),
        ) as rend,
    ):
        code = main(
            [
                "--image",
                str(image_path),
                "--prompt",
                "person",
                "--output",
                str(output_path),
            ]
        )

    assert code == 0
    assert output_path.is_file()
    seg.assert_called_once()
    rend.assert_called_once()


def test_cli_json_stdout(
    tmp_path: Path, sample_rgb_image: Image.Image, capsys
) -> None:
    image_path = tmp_path / "in.png"
    output_path = tmp_path / "out.png"
    sample_rgb_image.save(image_path)

    fake_result = SegmentationResult(
        masks=[],
        scores=[],
        boxes=[],
        count=2,
        prompt="cat",
        device="mps",
        model_id="facebook/sam3",
    )

    with (
        patch("inference.cli.segment", return_value=fake_result),
        patch("inference.cli.render", return_value=sample_rgb_image.copy()),
    ):
        code = main(
            [
                "--image",
                str(image_path),
                "--prompt",
                "cat",
                "--output",
                str(output_path),
            ]
        )

    assert code == 0
    payload = json.loads(capsys.readouterr().out.strip())
    assert payload["count"] == 2
    assert payload["prompt"] == "cat"
    assert payload["device"] == "mps"
    assert payload["output"] == str(output_path)


def test_cli_bad_image_returns_2(tmp_path: Path, capsys) -> None:
    bad = tmp_path / "bad.jpg"
    bad.write_bytes(b"xxx")
    code = main(
        [
            "--image",
            str(bad),
            "--prompt",
            "person",
            "--output",
            str(tmp_path / "out.png"),
        ]
    )
    assert code == 2
    err = json.loads(capsys.readouterr().err.strip())
    assert "error" in err
