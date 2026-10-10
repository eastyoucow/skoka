"""Small stderr progress helper for long-running local inference."""

from __future__ import annotations

import sys
import time


def log(message: str) -> None:
    """Print a timestamped progress line to stderr (always flushed)."""
    stamp = time.strftime("%H:%M:%S")
    print(f"[inference {stamp}] {message}", file=sys.stderr, flush=True)
