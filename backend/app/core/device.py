"""
Centralized device selection for PyTorch inference.

Single source of truth: every model loads through `get_device()`.
Apple Silicon (MPS) → CPU fallback. Never CUDA in this project.

Decision: We set PYTORCH_ENABLE_MPS_FALLBACK=1 at import time so ops
that MPS doesn't support yet silently fall back to CPU instead of
crashing mid-inference. This is the pragmatic choice for a prototype
running multiple model architectures (YOLO, AST) on Apple Silicon.
"""

import os
import logging
from functools import lru_cache

# Set before any torch import to avoid crashes on unsupported MPS ops
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

logger = logging.getLogger("spectra.device")


@lru_cache(maxsize=1)
def get_device() -> str:
    """Return the best available PyTorch device string.

    Priority: MPS (Apple Silicon GPU) → CPU.
    Result is cached for the process lifetime.
    """
    try:
        import torch
    except ImportError:
        logger.warning("PyTorch not installed — defaulting to 'cpu' (no inference possible)")
        return "cpu"

    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        # Sanity-check: try a tiny allocation to catch driver issues
        try:
            _test = torch.zeros(1, device="mps")
            del _test
            logger.info("Using device: mps (Apple Silicon GPU)")
            return "mps"
        except Exception as exc:
            logger.warning("MPS reported available but allocation failed (%s) — falling back to CPU", exc)

    logger.info("Using device: cpu")
    return "cpu"


def device_info() -> dict:
    """Return a JSON-friendly dict of device diagnostics."""
    info = {"selected_device": get_device()}
    try:
        import torch

        info["pytorch_version"] = torch.__version__
        info["mps_available"] = hasattr(torch.backends, "mps") and torch.backends.mps.is_available()
        info["mps_built"] = hasattr(torch.backends, "mps") and torch.backends.mps.is_built()
    except ImportError:
        info["pytorch_version"] = None
        info["mps_available"] = False
        info["mps_built"] = False

    try:
        import psutil

        mem = psutil.virtual_memory()
        info["ram_total_gb"] = round(mem.total / (1024**3), 1)
        info["ram_available_gb"] = round(mem.available / (1024**3), 1)
        info["cpu_count"] = psutil.cpu_count(logical=True)
    except ImportError:
        pass

    return info
