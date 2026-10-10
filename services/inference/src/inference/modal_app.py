"""
Modal deployment for Skoka SAM3 inference.

Deploy from services/inference:

    modal deploy -m inference.modal_app

Smoke (requires Modal auth + secret ``skoka-dev`` from ``.env.modal``):

    modal run -m inference.modal_app --input-key jobs/.../input.jpg \\
        --prompt person --callback-url https://example.com

Create/update the secret:

    modal secret create skoka-dev --from-dotenv .env.modal
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import modal

APP_NAME = "skoka-inference"
FUNCTION_NAME = "run_job"
# Single Modal Secret created from services/inference/.env.modal
SECRET_NAME = "skoka-dev"

# Service root: .../services/inference (contains pyproject.toml and src/)
_SERVICE_ROOT = Path(__file__).resolve().parents[2]

_image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install(
        "torch==2.14.1",
        "torchvision==0.29.1",
        extra_index_url="https://download.pytorch.org/whl/cu124",
    )
    .pip_install(
        "transformers==5.19.0",
        "Pillow==11.3.0",
        "numpy==2.5.3",
        "python-dotenv==1.2.4",
        "boto3==1.40.46",
        "httpx==0.28.1",
    )
    .env(
        {
            "HF_HOME": "/root/.cache/huggingface",
            "INFERENCE_DEVICE": "cuda",
            "SAM3_DTYPE": "float16",
            "PYTHONPATH": "/root/src",
        }
    )
    .add_local_dir(
        str(_SERVICE_ROOT / "src"),
        remote_path="/root/src",
    )
)

app = modal.App(APP_NAME)


@app.function(
    image=_image,
    gpu="T4",
    timeout=600,
    memory=8192,
    min_containers=0,
    max_containers=2,
    secrets=[modal.Secret.from_name(SECRET_NAME)],
)
def run_job(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Async worker entrypoint. NestJS (Phase 4) will call:

        fn = modal.Function.from_name("skoka-inference", "run_job")
        call = fn.spawn(payload)
        # persist call.object_id as modal_call_id

    Runtime env comes from Modal Secret ``skoka-dev`` (HF_TOKEN, R2_*,
    CALLBACK_SHARED_SECRET, SAM3_*). Device is forced to CUDA here.
    """
    from inference.job import run_job as execute

    result = execute(payload, device_preference="cuda")
    return {
        "ok": result.ok,
        "count": result.count,
        "outputKey": result.output_key,
        "errorCode": result.error_code,
        "errorMessage": result.error_message,
    }


@app.local_entrypoint()
def main(
    input_key: str,
    prompt: str = "person",
    callback_url: str = "https://example.invalid",
    job_id: str = "local-smoke-job",
    attempt_id: str = "local-smoke-attempt",
    output_key: str = "",
) -> None:
    """Spawn a single job against the deployed or ephemeral app."""
    out = output_key or f"jobs/{job_id}/attempts/{attempt_id}/result.png"
    payload = {
        "jobId": job_id,
        "attemptId": attempt_id,
        "inputKey": input_key,
        "prompt": prompt,
        "outputKey": out,
        "callbackUrl": callback_url,
    }
    print(f"Spawning {FUNCTION_NAME} with payload keys={list(payload)}")
    result = run_job.remote(payload)
    print(result)
