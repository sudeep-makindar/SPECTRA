"""
Provider-agnostic LLM client (OpenAI-compatible chat completions).

Groq, xAI Grok, OpenRouter, Google Gemini and a local Ollama all expose the
same /chat/completions API, so one client covers them. Pick a provider with
`LLM_PROVIDER` and give its key in the matching env var (see PROVIDERS).

Model names change often, so if the configured model is not found the client
lists the provider's models and switches to the best available match instead
of failing the demo.
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

from openai import AsyncOpenAI, BadRequestError, NotFoundError

from app.core.config import load_config

logger = logging.getLogger("spectra.ai.llm")

PROVIDERS: dict[str, dict[str, Any]] = {
    "groq": {
        "label": "Groq",
        "base_url": "https://api.groq.com/openai/v1",
        "key_env": "GROQ_API_KEY",
        "model": "llama-3.3-70b-versatile",
        "prefer": ["gpt-oss-120b", "llama-3.3-70b", "llama-4", "qwen", "llama"],
    },
    "xai": {
        "label": "xAI Grok",
        "base_url": "https://api.x.ai/v1",
        "key_env": "XAI_API_KEY",
        "model": "grok-3-mini",
        "prefer": ["grok-4-fast", "grok-3-mini", "grok-4", "grok"],
    },
    "openrouter": {
        "label": "OpenRouter",
        "base_url": "https://openrouter.ai/api/v1",
        "key_env": "OPENROUTER_API_KEY",
        "model": "meta-llama/llama-3.3-70b-instruct:free",
        "prefer": [":free"],
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


class LLMClient:
    def __init__(self) -> None:
        cfg = load_config().llm
        self.provider = (os.getenv("LLM_PROVIDER") or cfg.provider or "groq").lower()
        preset = PROVIDERS.get(self.provider, {})
        self.label = preset.get("label", self.provider)
        self.base_url = os.getenv("LLM_BASE_URL") or cfg.base_url or preset.get("base_url", "")
        key_env = preset.get("key_env")
        self.api_key = (os.getenv("LLM_API_KEY") or cfg.api_key
                        or (os.getenv(key_env) if key_env else None)
                        or ("ollama" if self.provider == "ollama" else ""))
        self.model = os.getenv("LLM_MODEL") or cfg.model or preset.get("model", "")
        self._prefer = preset.get("prefer", [])
        self._json_mode = True
        self._client: AsyncOpenAI | None = None

    @property
    def enabled(self) -> bool:
        return bool(self.provider in PROVIDERS or self.base_url) and bool(self.api_key) and bool(self.base_url)

    @property
    def key_env(self) -> str | None:
        return PROVIDERS.get(self.provider, {}).get("key_env")

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

    async def chat(self, system: str, user: str, *, json_mode: bool = False, max_tokens: int = 1200,
                   temperature: float = 0.3) -> str:
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
