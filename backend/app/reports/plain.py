"""
Plain language for people outside the control room (Telegram, reports).

The fusion engine writes its reasons for engineers and for the LLM
("Density 4.2 people/m² — Fruin LoS E (Unavoidable contact)"). This says the
same thing the way an operator would. Mirrors plain() in frontend/src/ui/live.ts.
"""

from __future__ import annotations

import re

LEVEL_WORD = {"normal": "Calm", "elevated": "Watch", "high": "Needs attention", "critical": "Act now"}
CROWDING = {"A": "Plenty of room", "B": "Plenty of room", "C": "Getting busy", "D": "Crowded",
            "E": "Packed tight", "F": "Crush danger"}
_SENSE = {"vision": "camera", "motion": "movement", "audio": "sound"}

_RULES: list[tuple[re.Pattern, object]] = [
    (re.compile(r"Density ([\d.]+) people/m² — Fruin LoS ([A-F]) \([^)]*\)"),
     lambda m: f"{CROWDING.get(m[2], 'Crowded')} ({m[1]} people per m²)"),
    (re.compile(r"Sudden motion surge ([\d.]+)× camera baseline"), lambda m: f"People suddenly moving {m[1]}× faster than usual"),
    (re.compile(r"Sudden crowd motion surge vs baseline"), lambda m: "People suddenly moving much faster than usual"),
    (re.compile(r"Crowd turbulence — heading variance [\d.]+"), lambda m: "People moving in many directions at once"),
    (re.compile(r"Impulsive gunshot/explosion acoustic signature"), lambda m: "Gunshot or explosion sound"),
    (re.compile(r"Acoustic threat: (.+?) \(\d+%\)"), lambda m: f"Heard: {m[1]}"),
    (re.compile(r"Distress keyword “(.+?)” heard: “(.*?)”"), lambda m: f"Someone shouted “{m[1]}”: “{m[2]}”"),
    (re.compile(r"Cross-modal confirmation: (.+) agree"),
     lambda m: "Confirmed: " + " and ".join(_SENSE.get(s, s) for s in m[1].split(" + ")) + " agree"),
    (re.compile(r"Single-modality signal \((\w+)\) — capped until corroborated"),
     lambda m: f"Only the {_SENSE.get(m[1], m[1])} is worried, so the alarm is held back"),
    (re.compile(r"Trend: CRITICAL in ~(\d+) s at current rate"), lambda m: f"Could reach “Act now” in about {m[1]} s"),
    (re.compile(r"All sources offline — zone is blind; treat as unknown, not calm"),
     lambda m: "Every sensor here stopped. Treat the zone as unknown, not calm"),
    (re.compile(r"(\d+) person\(s\) appear to be down"), lambda m: f"{m[1]} person may be on the ground"),
]


def plain(text: str) -> str:
    for rx, fn in _RULES:
        text = rx.sub(fn, text, count=1)
    return re.sub(r"\b(NORMAL|ELEVATED|HIGH|CRITICAL)\b", lambda m: LEVEL_WORD[m[1].lower()], text)


def plain_summary(summary: str, source: str) -> str:
    """Offline-template summaries are engine reasons joined by "; " — make each one plain."""
    if source != "template":
        return summary
    parts = [plain(p.strip()) for p in summary.rstrip(".").split(";") if p.strip()]
    return ". ".join(parts) + "." if parts else summary
