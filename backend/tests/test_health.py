"""
Test: health endpoint and core utilities.

These run without any ML dependencies — they verify the scaffold works.
"""

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    """Create a test client for the Spectra API."""
    from app.main import app
    return TestClient(app)


def test_health_returns_ok(client):
    """The health endpoint must always respond, even if workers are down."""
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "version" in data
    assert "device" in data
    assert "timestamp" in data


def test_health_includes_device_info(client):
    """Health should report device selection for debugging."""
    response = client.get("/api/health")
    data = response.json()
    device = data["device"]
    assert "selected_device" in device
    assert device["selected_device"] in ("mps", "cpu")


def test_metrics_returns_snapshot(client):
    """Metrics endpoint should return structured data even when empty."""
    response = client.get("/api/metrics")
    assert response.status_code == 200
    data = response.json()
    assert "uptime_s" in data
    assert "latencies" in data
    assert "sources" in data


def test_config_redacts_api_key(client):
    """Config endpoint must never leak API keys."""
    response = client.get("/api/config")
    assert response.status_code == 200
    data = response.json()
    llm = data.get("llm", {})
    # API key should be redacted or empty
    assert llm.get("api_key", "") in ("", "***")


def test_sources_stub_returns_list(client):
    """Source list should return an empty list (stub for Phase 1)."""
    response = client.get("/api/sources")
    assert response.status_code == 200
    assert response.json() == []


def test_zones_stub_returns_list(client):
    response = client.get("/api/zones")
    assert response.status_code == 200
    assert response.json() == []


def test_incidents_stub_returns_list(client):
    response = client.get("/api/incidents")
    assert response.status_code == 200
    assert response.json() == []
