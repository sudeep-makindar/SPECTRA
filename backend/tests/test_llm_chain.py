"""
Test: the LLM provider chain.

LLM_PROVIDER may list several providers, best first. These tests use fake
providers, so they never call a real API.
"""

import pytest


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    from app.core.config import load_config
    for var in ("LLM_PROVIDER", "LLM_MODEL", "LLM_API_KEY", "LLM_BASE_URL",
                "GROQ_API_KEY", "GROQ_MODEL", "OPENROUTER_API_KEY", "OPENROUTER_MODEL",
                "XAI_API_KEY", "GEMINI_API_KEY"):
        monkeypatch.delenv(var, raising=False)
    load_config.cache_clear()
    yield
    load_config.cache_clear()


def test_chain_skips_providers_without_a_key(monkeypatch):
    from app.ai.llm import LLMClient
    monkeypatch.setenv("LLM_PROVIDER", "groq,openrouter")
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test")  # only the second has a key

    c = LLMClient()
    assert c.enabled
    assert [p.name for p in c._chain] == ["openrouter"]
    assert c.label == "OpenRouter"
    assert c.backups == []
    # The message still names the *first choice's* key, so the operator knows what to set.
    assert c.key_env == "GROQ_API_KEY"


def test_no_keys_means_offline(monkeypatch):
    from app.ai.llm import LLMClient
    monkeypatch.setenv("LLM_PROVIDER", "groq,openrouter")
    c = LLMClient()
    assert not c.enabled and c._chain == []
    assert c.label == "Groq" and c.key_env == "GROQ_API_KEY"


def test_per_provider_model_override(monkeypatch):
    from app.ai.llm import LLMClient
    monkeypatch.setenv("LLM_PROVIDER", "groq,openrouter")
    monkeypatch.setenv("GROQ_API_KEY", "gsk-test")
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test")
    monkeypatch.setenv("OPENROUTER_MODEL", "google/gemma-4-31b-it:free")

    c = LLMClient()
    assert [(p.name, p.model) for p in c._chain] == [
        ("groq", "openai/gpt-oss-120b"), ("openrouter", "google/gemma-4-31b-it:free")]
    assert c.backups == ["OpenRouter"]


async def test_second_provider_answers_when_the_first_fails(monkeypatch):
    from app.ai.llm import LLMClient
    monkeypatch.setenv("LLM_PROVIDER", "groq,openrouter")
    monkeypatch.setenv("GROQ_API_KEY", "gsk-test")
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test")
    c = LLMClient()
    tried = []

    async def groq_fails(*a, **k):
        tried.append("groq")
        raise RuntimeError("rate limited")

    async def openrouter_answers(*a, **k):
        tried.append("openrouter")
        return '{"hi": "कृपया"}'

    monkeypatch.setattr(c._chain[0], "chat", groq_fails)
    monkeypatch.setattr(c._chain[1], "chat", openrouter_answers)

    assert await c.chat("sys", "user") == '{"hi": "कृपया"}'
    assert tried == ["groq", "openrouter"]
    # The dashboard must show who actually wrote it.
    assert c.label == "OpenRouter" and c.provider == "openrouter"


async def test_the_last_error_is_raised_when_every_provider_fails(monkeypatch):
    from app.ai.llm import LLMClient
    monkeypatch.setenv("LLM_PROVIDER", "groq,openrouter")
    monkeypatch.setenv("GROQ_API_KEY", "gsk-test")
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test")
    c = LLMClient()

    async def fail(name):
        async def inner(*a, **k):
            raise RuntimeError(f"{name} down")
        return inner

    monkeypatch.setattr(c._chain[0], "chat", await fail("groq"))
    monkeypatch.setattr(c._chain[1], "chat", await fail("openrouter"))
    with pytest.raises(RuntimeError, match="openrouter down"):
        await c.chat("sys", "user")


async def test_copilot_falls_back_to_templates_when_every_provider_fails(monkeypatch):
    """A dead LLM must never break an alert — the briefing uses templates instead."""
    from app.ai.copilot import Copilot
    monkeypatch.setenv("LLM_PROVIDER", "groq")
    monkeypatch.setenv("GROQ_API_KEY", "gsk-test")
    monkeypatch.setattr(Copilot, "_instance", None)
    cop = Copilot.instance()

    async def fail(*a, **k):
        raise RuntimeError("every provider down")

    monkeypatch.setattr(cop.llm, "chat", fail)
    answer = await cop.ask("Is the crowd safe?")
    assert answer["source"] == "error" and "unavailable" in answer["answer"].lower()
    assert "every provider down" in (cop.last_error or "")
