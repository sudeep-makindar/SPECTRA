"""
Test: zones, announcements and speakers through the HTTP API, plus the
settings loaders (.env and SPECTRA_* overrides).

Each test gets its own zones/devices files, so the real data/ folder is
never touched.
"""

import asyncio
import os

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    from app.zones import manager as zones_module
    from app.ingest import registry as registry_module
    from app.announce import AnnouncementHub

    monkeypatch.setattr(zones_module, "ZONES_FILE", tmp_path / "zones.json")
    monkeypatch.setattr(registry_module, "DEVICES_FILE", tmp_path / "devices.json")
    monkeypatch.setattr(zones_module.ZoneManager, "_instance", None)
    monkeypatch.setattr(registry_module.SourceRegistry, "_instance", None)
    monkeypatch.setattr(AnnouncementHub, "_instance", None)
    from app.main import app
    return TestClient(app)


def test_zone_create_place_delete(client):
    assert [z["id"] for z in client.get("/api/zones").json()] == ["venue"]

    stage = client.post("/api/zones", json={"name": "Stage Front", "lat": 12.97, "lng": 77.59, "radius_m": 30}).json()
    assert stage["id"] == "stage-front"
    assert (stage["lat"], stage["lng"], stage["radius_m"]) == (12.97, 77.59, 30)

    moved = client.patch("/api/zones/stage-front", json={"lat": 12.98}).json()
    assert moved["lat"] == 12.98 and moved["lng"] == 77.59

    # A device in the deleted zone moves to the remaining one.
    dev = client.post("/api/sources", json={"name": "Phone", "adapter": "browser_node", "zone_id": "stage-front"}).json()
    assert client.delete("/api/zones/stage-front").status_code == 200
    assert [z["id"] for z in client.get("/api/zones").json()] == ["venue"]
    assert next(s for s in client.get("/api/sources").json() if s["id"] == dev["id"])["zone_id"] == "venue"

    # The last zone can't be deleted.
    assert client.delete("/api/zones/venue").status_code == 400


def test_zone_needs_a_name(client):
    assert client.post("/api/zones", json={"name": "  "}).status_code == 400


def test_dashboard_speaker_counts_for_announcements(client):
    client.post("/api/zones", json={"name": "Gate"})
    client.post("/api/speakers/heartbeat", json={"id": "dash-1", "name": "Gate laptop", "zone_id": "gate"})
    client.post("/api/speakers/heartbeat", json={"id": "dash-2", "name": "Control room", "zone_id": None})

    # A Gate announcement plays on the Gate speaker and the every-zone speaker.
    r = client.post("/api/announce", json={"zone_id": "gate", "items": [{"lang": "en", "text": "Please move back."},
                                                                          {"lang": "hi", "text": "कृपया पीछे हटें।"}]}).json()
    assert r["speakers"] == 2 and set(r["names"]) == {"Gate laptop", "Control room"}

    # A Venue announcement skips the Gate-only speaker.
    r = client.post("/api/announce", json={"zone_id": "venue", "items": [{"lang": "en", "text": "Hello"}]}).json()
    assert r["names"] == ["Control room"]

    client.delete("/api/speakers/dash-1")
    from app.announce import AnnouncementHub
    assert [s["id"] for s in AnnouncementHub.instance().speakers()] == ["dash-2"]
    assert AnnouncementHub.instance().recent()[0]["items"][1]["text"] == "कृपया पीछे हटें।"


def test_empty_announcement_is_rejected(client):
    assert client.post("/api/announce", json={"items": [{"lang": "en", "text": "   "}]}).status_code == 400


def test_device_speaker_gets_the_announcement_pushed(client):
    phone = client.post("/api/sources", json={"name": "Speaker phone", "adapter": "browser_node",
                                              "capabilities": {"video": False, "audio": False, "speaker": True}}).json()
    with client.websocket_connect(f"/ws/node?token={phone['token']}") as ws:
        r = client.post("/api/announce", json={"items": [{"lang": "ta", "text": "தயவுசெய்து அமைதியாக இருங்கள்."}]}).json()
        assert r["names"] == ["Speaker phone"]
        msg = ws.receive_json()
        assert msg["type"] == "announce" and msg["items"][0]["lang"] == "ta"


def test_translate_without_ai_explains_why(client, monkeypatch):
    from app.ai.copilot import Copilot
    monkeypatch.setattr(Copilot, "enabled", property(lambda self: False))
    r = client.post("/api/announce/translate", json={"text": "Please move back.", "languages": ["hi", "ta"]})
    assert r.status_code == 503
    assert "offline" in r.json()["detail"]


def test_env_overrides_keep_underscored_keys(monkeypatch):
    from app.core.config import load_config
    monkeypatch.setenv("SPECTRA_VIDEO_YOLO_MODEL", "yolo26n.pt")
    monkeypatch.setenv("SPECTRA_SERVER_LOG_LEVEL", "debug")
    monkeypatch.setenv("SPECTRA_SIM_MODE", "true")
    load_config.cache_clear()
    try:
        cfg = load_config()
        assert (cfg.video.yolo_model, cfg.server.log_level, cfg.sim_mode) == ("yolo26n.pt", "debug", True)
    finally:
        load_config.cache_clear()


def test_dotenv_strips_inline_comments(tmp_path, monkeypatch):
    import app.main as main
    (tmp_path / ".env").write_text('LLM_PROVIDER=groq      # groq | xai\nGROQ_API_KEY="gsk # inside quotes"\n', encoding="utf-8")
    monkeypatch.setattr(main, "PROJECT_ROOT", tmp_path)
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    main._load_dotenv()
    assert os.environ["LLM_PROVIDER"] == "groq"
    assert os.environ["GROQ_API_KEY"] == "gsk # inside quotes"
