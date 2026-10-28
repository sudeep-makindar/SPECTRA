"""
AI Co-pilot — incident briefings, operator Q&A and shift handover reports.

Runs on any OpenAI-compatible LLM (Groq by default; xAI Grok, OpenRouter,
Gemini or a fully local Ollama via LLM_PROVIDER — see app/ai/llm.py).

Privacy boundary: the model only ever receives *structured signal metadata*
(scores, headcounts, density, audio class labels, keyword transcripts, zone
SOPs). Video frames and raw audio never leave the edge machine.

Every call degrades gracefully: with no key, a network error or invalid
output, the co-pilot falls back to deterministic templates so the control
room never loses its briefing.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Literal, Optional

from pydantic import BaseModel, Field, ValidationError

from app.ai.llm import LLMClient, parse_json

logger = logging.getLogger("spectra.ai.copilot")

SYSTEM_PROMPT = """You are SPECTRA's incident co-pilot, embedded in the control room of a large Indian venue \
(stadiums, concerts, religious gatherings, railway concourses). Operators read your output under time pressure.

You receive structured, privacy-preserving signal data from SPECTRA's on-device perception: YOLO headcounts \
converted to people/m² and Fruin Level of Service (LoS D ≥1.54/m², E ≥3.57/m², F ≥5/m² = crush danger), \
baseline-relative optical-flow surges, acoustic classes, distress keywords (English, Hindi, Tamil, Telugu), \
and the gated fusion score. Fusion caps any single sensor; corroboration across sensors compounds risk.

Rules:
- SPECTRA is decision support, not a certified safety system. Be calibrated: say what the signals show, how \
confident you are, and what could make it a false alarm. Never invent facts that are not in the data.
- Ground recommended actions in the venue's standard operating procedures when they fit; name the responsible role.
- Public-address announcements must be calm, short and directional (tell people where to go). Never use the \
words "stampede" or "panic" in a PA message.
- Write plainly."""

BRIEF_FORMAT = """Respond with ONLY a JSON object of this exact shape:
{
  "headline": "≤12 words: what is happening and where",
  "summary": "2-3 sentences: what the sensors show and why risk is elevated",
  "likely_situation": "most likely real-world interpretation, one sentence",
  "false_alarm_check": "what could make this a false alarm and how to verify quickly",
  "confidence": "low" | "medium" | "high",
  "recommended_actions": [{"role": "who acts", "action": "one imperative sentence", "priority": "now" | "next" | "monitor"}],
  "pa_announcement_en": "calm PA message in English, ≤35 words",
  "pa_announcement_hi": "the same PA message in Hindi, Devanagari script"
}
Give 3-5 recommended_actions, most urgent first."""


class Action(BaseModel):
    role: str
    action: str
    priority: Literal["now", "next", "monitor"] = "next"


class IncidentBrief(BaseModel):
    headline: str
    summary: str
    likely_situation: str = ""
    false_alarm_check: str = ""
    confidence: Literal["low", "medium", "high"] = "medium"
    recommended_actions: list[Action] = Field(default_factory=list)
    pa_announcement_en: str = ""
    pa_announcement_hi: str = ""


class Copilot:
    _instance: Optional["Copilot"] = None

    def __init__(self) -> None:
        self.llm = LLMClient()
        self.last_error: str | None = None
        self.calls = 0

    @classmethod
    def instance(cls) -> "Copilot":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    @property
    def enabled(self) -> bool:
        return self.llm.enabled

    @property
    def model(self) -> str:
        return self.llm.model

    def status(self) -> dict:
        return {
            "enabled": self.enabled,
            "provider": self.llm.provider,
            "provider_label": self.llm.label,
            "model": self.llm.model if self.enabled else "offline templates",
            "key_env": self.llm.key_env,
            "backups": self.llm.backups,
            "last_error": self.last_error,
            "calls": self.calls,
        }

    def _fail(self, exc: Exception) -> None:
        self.last_error = f"{type(exc).__name__}: {exc}"[:300]
        logger.warning("LLM call failed (%s): %s", self.llm.label, self.last_error)

    # ── Incident briefing ──────────────────────────────────────────────

    async def brief_incident(self, incident_id: str) -> None:
        from app.incidents.store import IncidentStore
        from app.zones.manager import ZoneManager
        from app.fusion.engine import FusionEngine

        store = IncidentStore.instance()
        inc = store.get(incident_id)
        if not inc:
            return
        zone = ZoneManager.instance().get(inc["zone_id"])
        context = {
            "zone": {"name": inc["zone_name"], "kind": zone.kind if zone else None,
                     "area_m2": zone.area_m2 if zone else None, "safe_capacity": zone.capacity if zone else None,
                     "standard_operating_procedures": zone.sop if zone else []},
            "incident": {"trigger_level": inc["trigger_level"], "peak_level": inc["peak_level"],
                         "peak_risk": inc["peak_risk"], "seconds_since_start": round(time.time() - inc["started_at"]),
                         "simulated_drill": inc.get("scenario")},
            "signals_at_peak": self._signal_view(inc["peak_snapshot"]),
            "risk_trend_last_60s": [round(p[1], 2) for p in inc["timeline"][-120:][::4]],
            "recent_events": [e["message"] for e in FusionEngine.instance().events(15)
                              if e["zone_id"] == inc["zone_id"]][-8:],
        }

        brief, source = None, "template"
        if self.enabled:
            try:
                brief = await self._llm_brief(context)
                source = "llm"
            except Exception as exc:
                self._fail(exc)
        if brief is None:
            brief = self._template_brief(inc, zone)

        inc = store.get(incident_id)
        if inc is None:
            return
        inc["brief"] = {**brief, "source": source,
                        "model": f"{self.llm.label} · {self.llm.model}" if source == "llm" else None,
                        "generated_at": time.time(), "for_level": inc["peak_level"]}
        inc["brief_status"] = "ready"
        store.add_log(incident_id, "briefed", "copilot",
                      f"Briefing generated by {self.llm.label if source == 'llm' else 'offline template'}")
        FusionEngine.instance().log_event(inc["zone_id"], "brief_ready", "info",
                                          f"AI brief: {brief['headline']}", incident_id=incident_id)

    @staticmethod
    def _signal_view(snap: dict) -> dict:
        return {
            "fused_risk": snap.get("risk_score"),
            "alert_level": snap.get("alert_level"),
            "people_count": snap.get("people_count"),
            "density_people_per_m2": snap.get("density_ppm2"),
            "fruin_los": f"{snap.get('los')} — {snap.get('los_desc')}",
            "people_down": snap.get("fallen_count"),
            "heading_chaos_0to1": snap.get("chaos_index"),
            "modality_scores": {m: (snap.get(m) or {}).get("score") for m in ("vision", "motion", "audio")},
            "active_modalities": snap.get("active_modalities"),
            "cross_modal_confirmed": snap.get("corroborated"),
            "gunshot_signature": snap.get("hard_trigger"),
            "audio_class": snap.get("audio_label"),
            "distress_keyword": snap.get("keyword"),
            "transcript": snap.get("transcript"),
            "sensor_reasons": snap.get("reasons"),
            "forecast": snap.get("forecast"),
            "blind_spot": snap.get("blind_spot"),
        }

    async def _llm_brief(self, context: dict) -> dict:
        self.calls += 1
        user = ("Brief the control room on this incident.\n\nSignal data:\n"
                + json.dumps(context, ensure_ascii=False, indent=1) + "\n\n" + BRIEF_FORMAT)
        text = await self.llm.chat(SYSTEM_PROMPT, user, json_mode=True, max_tokens=1400, temperature=0.2)
        try:
            brief = IncidentBrief.model_validate(parse_json(text))
        except (ValidationError, ValueError) as exc:
            raise RuntimeError(f"invalid briefing JSON: {exc}") from exc
        if not brief.recommended_actions:
            raise RuntimeError("briefing had no actions")
        self.last_error = None
        return brief.model_dump()

    @staticmethod
    def _template_brief(inc: dict, zone) -> dict:
        snap = inc["peak_snapshot"]
        reasons = snap.get("reasons") or ["Fused risk crossed the alert threshold"]
        headline = {"critical": "Crowd in danger: act now", "high": "Crowd needs attention"}.get(
            inc["peak_level"], "Unusual crowd activity")
        sop = (zone.sop if zone else []) or ["Send the nearest stewards to the crowd"]
        actions = [{"role": "Control room", "action": "Look at the live camera and confirm what the sensors report", "priority": "now"}]
        actions += [{"role": "Stewards", "action": s, "priority": "next"} for s in sop[:3]]
        return {
            "headline": headline,
            "summary": "; ".join(reasons[:3]) + ".",
            "likely_situation": "Several sensors agree something is wrong. Check the live camera to confirm before acting.",
            "false_alarm_check": "Look at the live camera. One sensor alone can never raise this alarm, but a staged event or unusual noise could still trigger it.",
            "confidence": "high" if snap.get("corroborated") else "medium",
            "recommended_actions": actions,
            "pa_announcement_en": "Attention please. To keep everyone comfortable, please move slowly away from the crowded area and follow steward directions.",
            "pa_announcement_hi": "कृपया ध्यान दें। कृपया भीड़ वाले क्षेत्र से धीरे-धीरे दूर जाएँ और स्टीवर्ड के निर्देशों का पालन करें।",
        }

    # ── Announcement translation ───────────────────────────────────────

    LANGUAGE_NAMES = {"hi": "Hindi (Devanagari script)", "ta": "Tamil (Tamil script)", "en": "English"}

    async def translate(self, text: str, languages: list[str]) -> dict[str, str]:
        """Translate a PA announcement. Raises RuntimeError when no LLM is available."""
        wanted = [l for l in languages if l in self.LANGUAGE_NAMES and l != "en"]
        if not wanted:
            return {}
        if not self.enabled:
            raise RuntimeError(f"AI assistant is offline (set {self.llm.key_env or 'an LLM key'} in .env)")
        self.calls += 1
        spec = ", ".join(f'"{l}": "<{self.LANGUAGE_NAMES[l]}>"' for l in wanted)
        out = await self.llm.chat(
            "You translate public-address announcements for crowds at Indian venues. Keep the meaning, keep it "
            "calm, short and natural to say aloud, and keep directions (exits, gates) exact. Never add the words "
            "'stampede' or 'panic'. Respond with only a JSON object.",
            f"Announcement (English): {text}\n\nReturn exactly: {{{spec}}}",
            json_mode=True, max_tokens=600, temperature=0.1,
        )
        data = parse_json(out)
        result = {l: str(data.get(l, "")).strip() for l in wanted if str(data.get(l, "")).strip()}
        if not result:
            raise RuntimeError("the AI assistant returned no translation")
        self.last_error = None
        return result

    # ── Operator Q&A ───────────────────────────────────────────────────

    async def ask(self, question: str) -> dict:
        from app.fusion.engine import FusionEngine
        from app.incidents.store import IncidentStore

        engine = FusionEngine.instance()
        zones = []
        for zid in list(engine._zones):
            z = engine.get_zone(zid)
            if z:
                zones.append({"zone": z.name, **self._signal_view(z.to_dict(include_history=False)),
                              "risk_trend_per_min": z.forecast.get("slope_per_min"),
                              "sources_online": z.sources_online})
        context = {
            "zones": zones,
            "recent_events": [f"{time.strftime('%H:%M:%S', time.localtime(e['ts']))} {e['message']}"
                              for e in engine.events(25)],
            "incidents": IncidentStore.instance().summaries(10),
        }
        if not self.enabled:
            hottest = max(zones, key=lambda z: z["fused_risk"] or 0, default=None)
            answer = (f"AI co-pilot is offline (set {self.llm.key_env or 'LLM_API_KEY'}). Raw picture: "
                      + (f"highest risk is {hottest['zone']} at {round((hottest['fused_risk'] or 0) * 100)} "
                         f"({hottest['alert_level']}). " + "; ".join(hottest["sensor_reasons"] or [])
                         if hottest else "no sensor data yet."))
            return {"answer": answer, "source": "template"}
        try:
            self.calls += 1
            text = await self.llm.chat(
                SYSTEM_PROMPT + "\n\nAnswer the operator's question about the live situation in ≤120 words. "
                "Lead with the answer. Plain sentences or a short dash list; no headings, no markdown tables.",
                f"Live state:\n{json.dumps(context, ensure_ascii=False, default=str)}\n\nOperator question: {question}",
                max_tokens=500,
            )
            if not text:
                raise RuntimeError("empty answer")
            self.last_error = None
            return {"answer": text, "source": "llm", "model": f"{self.llm.label} · {self.llm.model}"}
        except Exception as exc:
            self._fail(exc)
            return {"answer": f"Co-pilot unavailable ({type(exc).__name__}). Check the live view directly.",
                    "source": "error"}

    # ── Shift handover ─────────────────────────────────────────────────

    async def shift_report(self) -> dict:
        from app.incidents.store import IncidentStore
        incidents = []
        for inc in IncidentStore.instance().all()[:25]:
            brief = inc.get("brief") or {}
            incidents.append({
                "zone": inc["zone_name"],
                "start": time.strftime("%H:%M:%S", time.localtime(inc["started_at"])),
                "duration_s": round((inc["ended_at"] or time.time()) - inc["started_at"]),
                "peak_level": inc["peak_level"], "peak_risk": inc["peak_risk"],
                "status": inc["status"], "drill": bool(inc.get("scenario")),
                "headline": brief.get("headline"),
                "reasons": (inc.get("peak_snapshot") or {}).get("reasons"),
                "operator_log": [f"{l['action']}: {l['note']}" for l in inc["log"] if l["by"] == "operator"],
            })
        if not incidents:
            return {"report": "No incidents recorded this shift.", "source": "template"}
        if not self.enabled:
            lines = [f"- {i['start']} {i['zone']}: {i['peak_level'].upper()} (risk {i['peak_risk']}), "
                     f"{i['duration_s']}s, status {i['status']}{' (drill)' if i['drill'] else ''}" for i in incidents]
            return {"report": "Shift handover (offline template)\n\n" + "\n".join(lines), "source": "template"}
        try:
            self.calls += 1
            text = await self.llm.chat(
                SYSTEM_PROMPT + "\n\nWrite a shift handover report in Markdown for the incoming control-room lead: "
                "overview (2 sentences), incidents table (time, zone, peak, status), open items needing follow-up, "
                "patterns to watch next shift, and sensor/coverage issues. Mark drills as drills. Under 350 words.",
                json.dumps({"incidents": incidents}, ensure_ascii=False),
                max_tokens=1200,
            )
            if not text:
                raise RuntimeError("empty report")
            return {"report": text, "source": "llm", "model": f"{self.llm.label} · {self.llm.model}"}
        except Exception as exc:
            self._fail(exc)
            return {"report": f"Co-pilot unavailable ({type(exc).__name__}).", "source": "error"}
