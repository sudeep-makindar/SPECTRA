"""
Provider-agnostic LLM client (OpenAI-compatible chat completions).

Groq, OpenRouter, xAI Grok, Google Gemini and a local Ollama all expose the
same /chat/completions API, so one client covers them.

`LLM_PROVIDER` may name several providers, best first:

    LLM_PROVIDER=openrouter,groq

The first one with a key answers; if it is down, rate-limited or out of
credit, the next one takes over automatically, so a demo never loses its AI
because one free tier ran out. Each provider's key and model come from its
own env vars (OPENROUTER_API_KEY / OPENROUTER_MODEL, GROQ_API_KEY / …).

Model names change often, so if the configured model is missing the client
lists the provider's models and switches to the best available match instead
of failing the demo.
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Optional

from openai import AsyncOpenAI, BadRequestError, NotFoundError

from app.core.config import load_config

logger = logging.getLogger("spectra.ai.llm")

PROVIDERS: dict[str, dict[str, Any]] = {
    "groq": {
        "label": "Groq",
        "base_url": "https://api.groq.com/openai/v1",
        "key_env": "GROQ_API_KEY",
        "model": "openai/gpt-oss-120b",
        "prefer": ["gpt-oss-120b", "gpt-oss", "llama-3.3-70b", "llama-4", "qwen3", "qwen", "llama"],
    },
    "openrouter": {
        "label": "OpenRouter",
        "base_url": "https://openrouter.ai/api/v1",
        "key_env": "OPENROUTER_API_KEY",
        "model": "google/gemma-4-31b-it:free",
        # Free models come and go and are often rate-limited; try the capable
        # families first, then anything free.
        "prefer": ["gemma-4-31b", "gemma-4", "llama-3.3-70b", "qwen3", "deepseek", ":free"],
    },
    "xai": {
        "label": "xAI Grok",
        "base_url": "https://api.x.ai/v1",
        "key_env": "XAI_API_KEY",
        "model": "grok-3-mini",
        "prefer": ["grok-4-fast", "grok-3-mini", "grok-4", "grok"],
    },
    "gemini": {
        "label": "Gemini",
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
        "key_env": "GEMINI_API_KEY",
        "model": "gemini-2.5-flash",
        "prefer": ["flash", "gemini"],
    },
    "ollama": {
        "label": "Ollama (local)",
        "base_url": "http://localhost:11434/v1",
        "key_env": None,
        "model": "llama3.2",
        "prefer": ["llama", "qwen", "gemma", "mistral"],
    },
}


class _Provider:
    """One OpenAI-compatible endpoint."""

    def __init__(self, name: str, *, base_url: str = "", api_key: str = "", model: str = "") -> None:
        preset = PROVIDERS.get(name, {})
        self.name = name
        self.label = preset.get("label", name)
        self.key_env = preset.get("key_env")
        self.base_url = base_url or preset.get("base_url", "")
        # Per-provider override first (OPENROUTER_MODEL), then the preset default.
        self.model = model or os.getenv(f"{name.upper()}_MODEL", "") or preset.get("model", "")
        self.api_key = api_key or (os.getenv(self.key_env) if self.key_env else "") or (
            "ollama" if name == "ollama" else "")
        self._prefer = preset.get("prefer", [])
        self._json_mode = True
        self._client: AsyncOpenAI | None = None

    @property
    def enabled(self) -> bool:
        return bool(self.base_url) and bool(self.api_key)

    def client(self) -> AsyncOpenAI:
        if self._client is None:
            self._client = AsyncOpenAI(api_key=self.api_key, base_url=self.base_url, timeout=45.0, max_retries=1)
        return self._client

    async def _pick_model(self) -> bool:
        """Configured model missing → choose the best available one."""
        try:
            models = [m.id async for m in self.client().models.list()]
        except Exception as exc:
            logger.warning("Could not list %s models: %s", self.label, exc)
            return False
        for pref in self._prefer:
            match = next((m for m in models if pref in m and "guard" not in m and "whisper" not in m), None)
            if match:
                logger.warning("Model %s not available on %s — switching to %s", self.model, self.label, match)
                self.model = match
                return True
        return False

    async def chat(self, system: str, user: str, *, json_mode: bool, max_tokens: int, temperature: float) -> str:
        kwargs: dict[str, Any] = dict(
            model=self.model, max_tokens=max_tokens, temperature=temperature,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        )
        if json_mode and self._json_mode:
            kwargs["response_format"] = {"type": "json_object"}
        for attempt in range(3):
            try:
                resp = await self.client().chat.completions.create(**kwargs)
                return (resp.choices[0].message.content or "").strip()
            except NotFoundError:
                if attempt == 0 and await self._pick_model():
                    kwargs["model"] = self.model
                    continue
                raise
            except BadRequestError as exc:
                msg = str(exc).lower()
                if "model" in msg and ("not found" in msg or "decommissioned" in msg or "does not exist" in msg) \
                        and attempt == 0 and await self._pick_model():
                    kwargs["model"] = self.model
                    continue
                if "response_format" in kwargs:  # provider/model without JSON mode
                    self._json_mode = False
                    kwargs.pop("response_format")
                    continue
                raise
        raise RuntimeError("LLM request failed after retries")


class LLMClient:
    """The configured providers, tried best-first."""

    def __init__(self) -> None:
        cfg = load_config().llm
        names = [n.strip().lower() for n in (os.getenv("LLM_PROVIDER") or cfg.provider or "groq").split(",") if n.strip()]
        # An explicit LLM_API_KEY / LLM_BASE_URL overrides the first provider,
        # so any other OpenAI-compatible server still works with one entry.
        override_key = os.getenv("LLM_API_KEY") or cfg.api_key
        override_url = os.getenv("LLM_BASE_URL") or cfg.base_url
        override_model = os.getenv("LLM_MODEL") or cfg.model
        chain: list[_Provider] = []
        for i, name in enumerate(names):
            p = _Provider(name,
                          base_url=override_url if i == 0 else "",
                          api_key=override_key if i == 0 else "",
                          model=override_model if i == 0 else "")
            if p.enabled:
                chain.append(p)
            elif p.key_env:
                logger.info("LLM provider %s skipped: no %s", p.label, p.key_env)
        self._chain = chain
        self._first_choice = names[0] if names else "groq"
        self.active: Optional[_Provider] = chain[0] if chain else None
        if len(chain) > 1:
            logger.info("AI assistant: %s, falling back to %s",
                        chain[0].label, ", ".join(p.label for p in chain[1:]))

    # ── What the co-pilot and the dashboard read ──────────────────────

    @property
    def enabled(self) -> bool:
        return bool(self._chain)

    @property
    def provider(self) -> str:
        return self.active.name if self.active else self._first_choice

    @property
    def label(self) -> str:
        return self.active.label if self.active else PROVIDERS.get(self._first_choice, {}).get("label", self._first_choice)

    @property
    def model(self) -> str:
        return self.active.model if self.active else ""

    @property
    def key_env(self) -> str | None:
        """Which key to set when nothing is configured."""
        return PROVIDERS.get(self._first_choice, {}).get("key_env")

    @property
    def backups(self) -> list[str]:
        return [p.label for p in self._chain[1:]]

    async def chat(self, system: str, user: str, *, json_mode: bool = False, max_tokens: int = 1200,
                   temperature: float = 0.3) -> str:
        if not self._chain:
            raise RuntimeError("No LLM provider is configured")
        last: Exception | None = None
        for i, provider in enumerate(self._chain):
            try:
                text = await provider.chat(system, user, json_mode=json_mode, max_tokens=max_tokens,
                                           temperature=temperature)
                if provider is not self.active:
                    logger.warning("AI assistant switched to %s", provider.label)
                self.active = provider
                return text
            except Exception as exc:
                last = exc
                if i + 1 < len(self._chain):
                    logger.warning("%s failed (%s: %s) — trying %s", provider.label, type(exc).__name__,
                                   str(exc)[:160], self._chain[i + 1].label)
        raise last if last else RuntimeError("LLM request failed")


def parse_json(text: str) -> dict:
    """Parse a JSON object from model output, tolerating code fences and preambles."""
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start >= 0 and end > start:
            return json.loads(text[start:end + 1])
        raise
