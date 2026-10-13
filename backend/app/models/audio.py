"""
Audio Model — AST acoustic threat classification + Whisper distress keywords.

* AST (MIT/ast-finetuned-audioset) is multi-label, so class probabilities are
  independent sigmoids, not a softmax over 527 classes.
* AudioSet labels are grouped into threat groups (config/audio_groups.yaml).
  A gunshot can hard-trigger, unless a benign look-alike (fireworks,
  firecrackers, drums) is more likely — Diwali-aware suppression.
* Whisper only runs when there is speech-like energy, which keeps CPU low and
  avoids Whisper's habit of hallucinating text on silence.
* Distress keywords are multilingual (English, Hindi, Tamil, Telugu) and
  matched on word boundaries, so "stopped" never counts as "stop".
"""

from __future__ import annotations

import logging
import re
import time
from typing import Any

import numpy as np
import torch
import yaml
from transformers import ASTForAudioClassification, ASTFeatureExtractor

from app.models.registry import BaseModel, ModelInfo
from app.core.config import load_config, CONFIG_DIR

logger = logging.getLogger("spectra.models.audio")

SPEECHY = {"Speech", "Shout", "Yell", "Screaming", "Child speech, kid speaking", "Conversation",
           "Narration, monologue", "Battle cry", "Crying, sobbing", "Children shouting"}
WEAK_KEYWORDS = {"stop", "run"}
RMS_GATE = 0.008


class AstAudioModel(BaseModel):
    def __init__(self, model_name: str = "MIT/ast-finetuned-audioset-10-10-0.4593"):
        self.model_name = model_name
        self._model = None
        self._extractor = None
        self._device = "cpu"
        self._loaded = False
        self._whisper = None
        self._config = load_config()

        raw = yaml.safe_load((CONFIG_DIR / "audio_groups.yaml").read_text())
        self._groups: dict[str, dict] = raw.get("groups", {})
        self._suppressors: dict[str, list[str]] = raw.get("suppressors", {})
        self._label_idx: dict[str, int] = {}

        kws = self._config.audio.distress_keywords
        self._kw_ascii = [(k, re.compile(rf"\b{re.escape(k)}\b", re.I)) for k in kws if k.isascii()]
        self._kw_unicode = [k for k in kws if not k.isascii()]

    def load(self, device: str) -> None:
        if self._loaded:
            return
        logger.info("Loading AST audio model (%s) on %s", self.model_name, device)
        self._device = device
        self._extractor = ASTFeatureExtractor.from_pretrained(self.model_name)
        self._model = ASTForAudioClassification.from_pretrained(self.model_name).to(device).eval()
        self._label_idx = {lbl: int(i) for i, lbl in self._model.config.id2label.items()}
        missing = [l for g in self._groups.values() for l in g["labels"] if l not in self._label_idx]
        if missing:
            logger.warning("Audio group labels not in AudioSet: %s", missing)

        if self._config.audio.whisper_enabled:
            try:
                import whisper
                # Whisper's sparse ops are unreliable on MPS; CPU tiny is fast enough.
                self._whisper = whisper.load_model(self._config.audio.whisper_model, device="cpu")
                logger.info("Whisper '%s' loaded for multilingual keyword spotting", self._config.audio.whisper_model)
            except Exception as exc:
                logger.warning("Whisper unavailable (%s) — keyword spotting disabled", exc)
        self._loaded = True
        logger.info("AST audio model loaded")

    def _prob(self, probs: torch.Tensor, label: str) -> float:
        idx = self._label_idx.get(label)
        return float(probs[idx]) if idx is not None else 0.0

    def predict(self, inputs: Any) -> dict:
        if not self._loaded or self._model is None:
            raise RuntimeError("Model not loaded")
        audio = np.asarray(inputs, dtype=np.float32)
        rms = float(np.sqrt(np.mean(audio ** 2))) if audio.size else 0.0

        feats = self._extractor(audio, sampling_rate=16000, return_tensors="pt")
        with torch.no_grad():
            logits = self._model(feats.input_values.to(self._device)).logits
        probs = torch.sigmoid(logits)[0].cpu()

        top_idx = int(torch.argmax(probs))
        top_class = self._model.config.id2label[top_idx]
        top_prob = float(probs[top_idx])

        # Threat groups
        group_scores: dict[str, tuple[float, str]] = {}
        for name, g in self._groups.items():
            best = max(((self._prob(probs, l), l) for l in g["labels"]), default=(0.0, None))
            group_scores[name] = best

        threat_label, score = None, 0.0
        for name, (p, lbl) in group_scores.items():
            s = min(1.0, self._groups[name].get("weight", 1.0) * p / 0.6)
            if s > score:
                score, threat_label = s, lbl

        gun_p = group_scores.get("gunshot", (0.0, None))[0]
        benign = max((self._prob(probs, l) for l in self._suppressors.get("gunshot", [])), default=0.0)
        hard_trigger = gun_p >= self._config.fusion.gunshot_hard_trigger and gun_p > benign
        suppressed = gun_p >= self._config.fusion.gunshot_hard_trigger and not hard_trigger
        if suppressed:
            score = min(score, 0.4)
            threat_label = f"{threat_label} (likely fireworks/music)"

        # Whisper keyword spotting, gated on speech-like energy
        detected_text, keyword, whisper_ms, language = "", None, None, None
        speechiness = max(self._prob(probs, l) for l in SPEECHY)
        if self._whisper is not None and rms > RMS_GATE and speechiness > 0.15:
            t0 = time.time()
            try:
                res = self._whisper.transcribe(audio, fp16=False, condition_on_previous_text=False,
                                               no_speech_threshold=0.6, temperature=0.0)
                segs = [s for s in res.get("segments", []) if s.get("no_speech_prob", 0) < 0.6]
                detected_text = " ".join(s["text"].strip() for s in segs).strip()
                language = res.get("language")
            except Exception as exc:
                logger.debug("Whisper failed: %s", exc)
            whisper_ms = (time.time() - t0) * 1000

            low = detected_text.lower()
            for k, rx in self._kw_ascii:
                if rx.search(low):
                    keyword = k
                    break
            if not keyword:
                keyword = next((k for k in self._kw_unicode if k in detected_text), None)
            if keyword:
                kw_score = 0.55 if keyword in WEAK_KEYWORDS else 0.8
                if kw_score > score:
                    score = kw_score
                    threat_label = f"Distress call: “{keyword}”"

        return {
            "audio_score": round(score, 3),
            "threat_label": threat_label if score > 0.1 else None,
            "top_class": top_class,
            "top_prob": round(top_prob, 3),
            "hard_trigger": hard_trigger,
            "gunshot_suppressed": suppressed,
            "detected_text": detected_text,
            "keyword": keyword,
            "language": language,
            "rms": round(rms, 4),
            "whisper_ms": whisper_ms,
            "groups": {k: round(v[0], 3) for k, v in group_scores.items()},
        }

    def info(self) -> ModelInfo:
        return ModelInfo(name="ast+whisper", version="audioset-10-10", source="pretrained",
                         device=self._device, loaded=self._loaded)
