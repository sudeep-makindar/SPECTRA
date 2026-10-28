"""
Test: incident reports and Telegram alerts.

Telegram is replaced by a local fake server that answers like the Bot API
and records every request, so these tests never touch the internet.
"""

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import numpy as np
import pytest


class FakeTelegram:
    """Answers getMe / getUpdates / send* like api.telegram.org and records sends."""

    def __init__(self):
        self.calls: list[tuple[str, bytes]] = []
        outer = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_POST(self):
                method = self.path.rsplit("/", 1)[-1]
                body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
                outer.calls.append((method, body))
                if "/botBAD/" in self.path:
                    return self._reply(401, {"ok": False, "description": "Unauthorized"})
                result = {
                    "getMe": {"username": "spectra_test_bot"},
                    "getUpdates": [{"message": {"chat": {"id": -1001, "title": "Venue staff", "type": "supergroup"}}},
                                   {"my_chat_member": {"chat": {"id": 42, "first_name": "Asha", "type": "private"}}}],
                }.get(method, {"message_id": len(outer.calls)})
                self._reply(200, {"ok": True, "result": result})

            def _reply(self, code, payload):
                data = json.dumps(payload).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

        self.server = HTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.server.server_port}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def sent(self, method):
        return [body for m, body in self.calls if m == method]


@pytest.fixture
def env(tmp_path, monkeypatch):
    """Isolated data folder, a fake Telegram, and one finished incident with a real clip."""
    from app.core import config
    from app.evidence.manager import _ClipWriter
    from app.incidents.store import IncidentStore
    from app.notify import telegram

    fake = FakeTelegram()
    incidents_dir = tmp_path / "incidents"
    incidents_dir.mkdir()
    for module in (config, telegram):
        monkeypatch.setattr(module, "INCIDENTS_DIR", incidents_dir, raising=False)
    from app.reports import incident_report
    monkeypatch.setattr(incident_report, "INCIDENTS_DIR", incidents_dir)
    monkeypatch.setattr(telegram, "SETTINGS_FILE", tmp_path / "telegram.json")
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "TEST")
    monkeypatch.setenv("TELEGRAM_API_BASE", fake.url)
    monkeypatch.setenv("SPECTRA_DASHBOARD_URL", "http://192.168.1.30:5173")
    monkeypatch.delenv("TELEGRAM_CHAT_ID", raising=False)
    monkeypatch.setattr(telegram.TelegramNotifier, "_instance", None)

    writer = _ClipWriter(incidents_dir / "gate_cam_1.mp4", 320, 240, 5.0)
    for i in range(20):
        writer.write(np.full((240, 320, 3), 40 + i * 8, np.uint8))
    writer.close()
    import cv2
    cv2.imwrite(str(incidents_dir / "gate_cam_1.jpg"), np.full((240, 320, 3), 120, np.uint8))

    t0 = time.time() - 60
    inc = {
        "id": "inc-test-1", "zone_id": "gate", "zone_name": "Gate", "started_at": t0, "ended_at": t0 + 45,
        "status": "resolved", "trigger_level": "high", "peak_level": "critical", "peak_risk": 0.93, "scenario": None,
        "peak_snapshot": {"people_count": 14, "density_ppm2": 4.3, "los": "E", "motion": {"score": 0.8},
                          "audio_label": "Screaming", "keyword": "bachao", "transcript": "bachao bachao",
                          "reasons": ["Density 4.3 people/m² — Fruin LoS E (Unavoidable contact)",
                                      "Distress keyword “bachao” heard: “bachao bachao”"]},
        "timeline": [[t0 + i, min(1, i / 30), 0.6, i / 45, 0.5] for i in range(45)],
        "clips": [{"source_id": "cam-1", "file": "gate_cam_1.mp4", "thumb_file": "gate_cam_1.jpg",
                   "duration_s": 4.0, "trigger_offset_s": 2.0, "face_blur": True}],
        "brief": {"headline": "Crowd in danger at the Gate", "summary": "Packed crowd and someone calling for help.",
                  "likely_situation": "A crush is forming at the gate.", "false_alarm_check": "Check the gate camera.",
                  "confidence": "high", "source": "llm",
                  "recommended_actions": [{"role": "Stewards", "action": "Hold entry at the outer gate", "priority": "now"}],
                  "pa_announcement_en": "Please stop and wait.", "pa_announcement_hi": "कृपया रुकें।"},
        "brief_status": "ready",
        "log": [{"ts": t0, "action": "opened", "by": "system", "note": "Gate reached HIGH (risk 0.60)"},
                {"ts": t0 + 10, "action": "acknowledged", "by": "operator", "note": ""}],
    }
    store = IncidentStore.instance()
    monkeypatch.setitem(store._incidents, inc["id"], inc)
    return fake, inc


def test_report_is_self_contained_and_plain(env):
    from app.reports.incident_report import build_report
    _, inc = env
    page = build_report(inc, [{"ts": inc["started_at"] + 20, "zone_name": "Gate",
                               "items": [{"lang": "ta", "text": "தயவுசெய்து நில்லுங்கள்."}]}])
    assert "Crowd in danger at the Gate" in page
    assert page.count("data:image/jpeg;base64,") == 4          # four frames from the H.264 clip
    assert "<polyline" in page                                  # timeline chart
    assert "Packed tight (4.3 people per m²)" in page            # engine jargon made plain
    assert "Fruin" not in page and "CRITICAL" not in page
    assert "Hold entry at the outer gate" in page and "Someone is on it" in page
    assert "தயவுசெய்து நில்லுங்கள்." in page
    assert "src=\"http" not in page and "src='http" not in page  # nothing loaded from elsewhere


def test_report_endpoint_downloads(env):
    from fastapi.testclient import TestClient
    from app.main import app
    r = TestClient(app).get("/api/incidents/inc-test-1/report?download=1")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/html")
    assert 'filename="spectra-report-inc-test-1.html"' in r.headers["content-disposition"]


async def test_telegram_finds_group_and_sends_test(env):
    from app.notify.telegram import TelegramNotifier
    fake, _ = env
    n = TelegramNotifier.instance()
    chats = await n.find_chats()
    assert {c["name"] for c in chats} == {"Venue staff", "Asha"}
    assert n.bot_name == "spectra_test_bot"
    n.set_chat_ids(["-1001"])
    assert await n.send_test() == 1
    assert b"chat_id=-1001" in fake.sent("sendMessage")[0]
    assert TelegramNotifier._load_chat_ids() == ["-1001"]  # saved for the next start


async def test_telegram_alert_sends_reason_then_details_then_report(env):
    from app.notify.telegram import TelegramNotifier
    fake, inc = env
    n = TelegramNotifier.instance()
    n.set_chat_ids(["-1001"])

    await n.on_incident(inc["id"], first=True)
    first = fake.sent("sendMessage")[0].decode()
    assert "Act+now+at+Gate" in first or "Act now at Gate" in first
    assert "inc-test-1" in first                               # dashboard link
    photo = fake.sent("sendPhoto")[0]
    assert b"image/jpeg" in photo and b"Hold entry at the outer gate" in photo

    await n.on_incident_closed(inc["id"])
    doc = fake.sent("sendDocument")[0]
    assert b"spectra-report-inc-test-1.html" in doc and b"calm again" in doc
    assert n.last_error is None and n.sent == 3


async def test_telegram_problems_are_reported_not_raised(env, monkeypatch):
    from app.notify.telegram import TelegramError, TelegramNotifier
    _, inc = env
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "BAD")
    monkeypatch.setattr(TelegramNotifier, "_instance", None)
    n = TelegramNotifier.instance()
    n.set_chat_ids(["-1001"])
    await n.on_incident(inc["id"], first=True)                # must not raise into the alert pipeline
    assert "Unauthorized" in n.last_error
    with pytest.raises(TelegramError):
        await n.send_test()


async def test_telegram_stays_quiet_until_set_up(env, monkeypatch):
    from app.notify.telegram import TelegramNotifier
    fake, inc = env
    await TelegramNotifier.instance().on_incident(inc["id"], first=True)  # no group chosen yet
    assert fake.calls == []
