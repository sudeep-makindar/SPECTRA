"""
Download every AI model SPECTRA uses, so the first start (and the venue)
needs no internet for them. Run from the backend folder:
    python ../scripts/prefetch_models.py

  YOLO person detector   → backend/yolo26s.pt and yolo26n.pt (~20 MB + ~6 MB)
  AST sound classifier   → Hugging Face cache            (~350 MB)
  Whisper speech model   → ~/.cache/whisper              (~75 MB for "tiny")
"""

import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND))

from app.core.config import load_config  # noqa: E402
from app.core.device import get_device  # noqa: E402


def main() -> None:
    import os
    os.chdir(BACKEND)  # YOLO saves its weights in the current folder
    cfg = load_config()
    print(f"Device for inference: {get_device()}")

    # Both sizes, so switching to the lighter one on the day needs no internet.
    from ultralytics import YOLO
    for name in dict.fromkeys([cfg.video.yolo_model, "yolo26s.pt", "yolo26n.pt"]):
        print(f"1/3 YOLO person detector ({name})…")
        YOLO(name)

    print(f"2/3 AST sound classifier ({cfg.audio.model_name})…")
    from transformers import ASTFeatureExtractor, ASTForAudioClassification
    ASTFeatureExtractor.from_pretrained(cfg.audio.model_name)
    ASTForAudioClassification.from_pretrained(cfg.audio.model_name)

    if cfg.audio.whisper_enabled:
        print(f"3/3 Whisper speech model ({cfg.audio.whisper_model})…")
        import whisper
        whisper.load_model(cfg.audio.whisper_model, device="cpu")

    print("All models downloaded.")


if __name__ == "__main__":
    main()
