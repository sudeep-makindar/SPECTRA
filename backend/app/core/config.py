"""
Application configuration — loaded from YAML + environment variables.

Every tunable lives in YAML, not code. Environment variables override
for deployment convenience (e.g. SPECTRA_HOST, SPECTRA_PORT).
"""

from __future__ import annotations

import os
import logging
from pathlib import Path
from functools import lru_cache
from typing import Any

import yaml
from pydantic import BaseModel, Field

logger = logging.getLogger("spectra.config")

# ── Paths ──────────────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).resolve().parents[3]  # /SPECTRA
BACKEND_ROOT = PROJECT_ROOT / "backend"
CONFIG_DIR = BACKEND_ROOT / "config"
DATA_DIR = PROJECT_ROOT / "data"
INCIDENTS_DIR = DATA_DIR / "incidents"


# ── Sub-configs (Pydantic for validation) ──────────────────────────────

class ServerConfig(BaseModel):
    host: str = "0.0.0.0"
    port: int = 8000
    reload: bool = False
    log_level: str = "info"
    cors_origins: list[str] = ["*"]


class VideoConfig(BaseModel):
    analysis_fps: int = 5
    # yolo26n.pt is ~3× faster than yolo26s.pt and a little less accurate on
    # small, distant people. Use it if the load test shows a slow machine.
    yolo_model: str = "yolo26s.pt"
    preview_width: int = 640
    preview_quality: int = 70  # JPEG quality for preview streams
    flow_width: int = 320  # Downscale target for optical flow
    flow_height: int = 180
    baseline_window_s: float = 60.0  # Rolling baseline for motion Z-score


class AudioConfig(BaseModel):
    sample_rate: int = 16000
    window_s: float = 2.0
    hop_s: float = 1.0
    model_name: str = "MIT/ast-finetuned-audioset-10-10-0.4593"
    model_mode: str = "pretrained"  # "pretrained" | "finetuned:<path>"
    whisper_enabled: bool = True
    whisper_model: str = "tiny"
    # Multilingual distress vocabulary (matched on word boundaries).
    distress_keywords: list[str] = Field(default_factory=lambda: [
        "help", "stop", "fire", "gun", "police", "run", "emergency", "ambulance",
        "bachao", "madad", "bhago", "aag", "बचाओ", "मदद", "भागो", "आग", "पुलिस",
        "kaapaathunga", "kapadu", "sahayam", "காப்பாத்துங்க", "உதவி", "కాపాడండి", "సహాయం",
    ])
    threat_groups: dict[str, list[str]] = Field(default_factory=lambda: {
        "high_risk": [
            "Screaming",
            "Yell",
            "Shout",
            "Gunshot, gunfire",
            "Explosion",
            "Glass"
        ]
    })


class FusionConfig(BaseModel):
    """Loaded from config/fusion.yaml, overridable per zone."""
    weight_density: float = 0.35
    weight_motion: float = 0.35
    weight_audio: float = 0.30
    cross_modal_multiplier: float = 1.4
    cross_modal_window_s: float = 3.0
    single_modal_dampen: float = 0.7
    ema_alpha: float = 0.3
    staleness_timeout_s: float = 10.0
    # State machine thresholds (up / down hysteresis)
    threshold_elevated_up: float = 0.30
    threshold_elevated_down: float = 0.20
    threshold_high_up: float = 0.55
    threshold_high_down: float = 0.40
    threshold_critical_up: float = 0.80
    threshold_critical_down: float = 0.65
    cooldown_s: float = 15.0
    # Hard-trigger overrides
    gunshot_hard_trigger: float = 0.80
    # Gated fusion: a single modality can never push risk above its cap.
    # Corroborated evidence (>=2 modalities active) compounds instead.
    active_threshold: float = 0.45
    active_vision: float = 0.60
    cap_vision: float = 0.72
    cap_motion: float = 0.50
    cap_audio: float = 0.50
    # Vision tuning
    vision_min_conf: float = 0.30
    vision_imgsz: int = 640


class EvidenceConfig(BaseModel):
    ring_buffer_s: float = 15.0
    pre_event_s: float = 5.0
    post_event_s: float = 5.0
    retention_days: int = 30
    face_blur: bool = False


class LLMConfig(BaseModel):
    provider: str = "groq"  # groq | xai | openrouter | gemini | ollama  (see app/ai/llm.py)
    model: str = ""         # empty → provider default
    api_key: str = ""       # empty → provider env var, e.g. GROQ_API_KEY
    base_url: str = ""      # empty → provider default (set for any other OpenAI-compatible server)


class AppConfig(BaseModel):
    """Top-level application configuration."""
    server: ServerConfig = Field(default_factory=ServerConfig)
    video: VideoConfig = Field(default_factory=VideoConfig)
    audio: AudioConfig = Field(default_factory=AudioConfig)
    fusion: FusionConfig = Field(default_factory=FusionConfig)
    evidence: EvidenceConfig = Field(default_factory=EvidenceConfig)
    llm: LLMConfig = Field(default_factory=LLMConfig)
    sim_mode: bool = False
    debug: bool = False


def _deep_merge(base: dict, override: dict) -> dict:
    """Recursively merge override into base."""
    merged = base.copy()
    for k, v in override.items():
        if k in merged and isinstance(merged[k], dict) and isinstance(v, dict):
            merged[k] = _deep_merge(merged[k], v)
        else:
            merged[k] = v
    return merged


def _load_yaml(path: Path) -> dict[str, Any]:
    """Load a YAML file, returning {} if it doesn't exist."""
    if not path.exists():
        logger.debug("Config file not found: %s — using defaults", path)
        return {}
    with open(path, "r") as f:
        data = yaml.safe_load(f)
    return data if isinstance(data, dict) else {}


def _apply_env_overrides(data: dict) -> dict:
    """Apply SPECTRA_* environment variable overrides.

    Convention: SPECTRA_SERVER_PORT=9000 → data["server"]["port"] = 9000.
    The first word is the section; the rest is the key, underscores and all
    (SPECTRA_VIDEO_YOLO_MODEL → video.yolo_model, SPECTRA_SIM_MODE → sim_mode).
    """
    prefix = "SPECTRA_"
    sections = set(AppConfig.model_fields) - {"sim_mode", "debug"}
    for key, val in os.environ.items():
        if not key.startswith(prefix):
            continue
        name = key[len(prefix):].lower()
        section, _, rest = name.partition("_")
        if section in sections and rest:
            target, final_key = data.setdefault(section, {}), rest
        else:
            target, final_key = data, name
        # Try to parse as int/float/bool
        if val.lower() in ("true", "false"):
            target[final_key] = val.lower() == "true"
        else:
            try:
                target[final_key] = int(val)
            except ValueError:
                try:
                    target[final_key] = float(val)
                except ValueError:
                    target[final_key] = val
    return data


@lru_cache(maxsize=1)
def load_config() -> AppConfig:
    """Load and validate the application configuration.

    Merge order: defaults → app.yaml → fusion.yaml → env overrides.
    """
    data: dict[str, Any] = {}

    # Load app.yaml
    app_yaml = _load_yaml(CONFIG_DIR / "app.yaml")
    data = _deep_merge(data, app_yaml)

    # Load fusion.yaml into the fusion key
    fusion_yaml = _load_yaml(CONFIG_DIR / "fusion.yaml")
    if fusion_yaml:
        data["fusion"] = _deep_merge(data.get("fusion", {}), fusion_yaml)

    # LLM config from env (common pattern)
    if os.getenv("LLM_PROVIDER"):
        data.setdefault("llm", {})["provider"] = os.getenv("LLM_PROVIDER", "")
    if os.getenv("LLM_MODEL"):
        data.setdefault("llm", {})["model"] = os.getenv("LLM_MODEL", "")
    if os.getenv("LLM_API_KEY"):
        data.setdefault("llm", {})["api_key"] = os.getenv("LLM_API_KEY", "")
    if os.getenv("LLM_BASE_URL"):
        data.setdefault("llm", {})["base_url"] = os.getenv("LLM_BASE_URL", "")

    # Apply SPECTRA_* env overrides
    data = _apply_env_overrides(data)

    config = AppConfig(**data)
    logger.info("Configuration loaded (server=%s:%d, sim_mode=%s)", config.server.host, config.server.port, config.sim_mode)
    return config


# Ensure data directories exist at import time
INCIDENTS_DIR.mkdir(parents=True, exist_ok=True)
