"""
Centralized device selection for PyTorch inference.

Single source of truth: every model loads through `get_device()`.
NVIDIA (CUDA) → Apple Silicon (MPS) → CPU. SPECTRA_DEVICE=cpu|mps|cuda
overrides the choice.

Decision: We set PYTORCH_ENABLE_MPS_FALLBACK=1 at import time so ops
that MPS doesn't support yet silently fall back to CPU instead of
crashing mid-inference. This is the pragmatic choice for a prototype
running multiple model architectures (YOLO, AST) on Apple Silicon.
"""

import os
import logging
import threading
from functools import lru_cache

# Set before any torch import to avoid crashes on unsupported MPS ops
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

logger = logging.getLogger("spectra.device")

# MPS is not thread-safe: two threads encoding GPU work at once abort the whole
# process ("A command encoder is already encoding to this command buffer").
# Every GPU inference call goes through this lock on a Mac. CUDA handles
# concurrent work from several threads, and CPU needs no lock.
_GPU_LOCK = threading.Lock()


def run_on_gpu(fn, *args):
    """Call fn(*args) holding the GPU lock when inference runs on MPS."""
    if get_device() != "mps":
        return fn(*args)
    with _GPU_LOCK:
        return fn(*args)


@lru_cache(maxsize=1)
def get_device() -> str:
    """Return the best available PyTorch device string.

    Priority: CUDA (NVIDIA GPU) → MPS (Apple Silicon GPU) → CPU.
    Result is cached for the process lifetime.
    """
    try:
        import torch
    except ImportError:
        logger.warning("PyTorch not installed — defaulting to 'cpu' (no inference possible)")
        return "cpu"

    forced = os.environ.get("SPECTRA_DEVICE", "").strip().lower()
    if forced in ("cpu", "mps", "cuda"):
        logger.info("Using device: %s (forced by SPECTRA_DEVICE)", forced)
        return forced

    if torch.cuda.is_available():
        try:
            _test = torch.zeros(1, device="cuda")
            del _test
            logger.info("Using device: cuda (%s)", torch.cuda.get_device_name(0))
            return "cuda"
        except Exception as exc:
            logger.warning("CUDA reported available but allocation failed (%s) — trying other devices", exc)

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
        info["cuda_available"] = torch.cuda.is_available()
        info["gpu_name"] = torch.cuda.get_device_name(0) if torch.cuda.is_available() else None
    except ImportError:
        info["pytorch_version"] = None
        info["mps_available"] = False
        info["mps_built"] = False
        info["cuda_available"] = False
        info["gpu_name"] = None

    try:
        import psutil

        mem = psutil.virtual_memory()
        info["ram_total_gb"] = round(mem.total / (1024**3), 1)
        info["ram_available_gb"] = round(mem.available / (1024**3), 1)
        info["cpu_count"] = psutil.cpu_count(logical=True)
    except ImportError:
        pass

    return info
