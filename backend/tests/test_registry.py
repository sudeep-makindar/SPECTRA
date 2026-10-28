"""
Test: device registry — token devices get their frames consumed, and devices
(with their pairing tokens) survive a restart.
"""

import asyncio
import time

import numpy as np

from app.ingest import registry as registry_module
from app.ingest.base import SourceKind, SourcePacket
from app.ingest.registry import SourceRegistry


def fresh_registry(tmp_path, monkeypatch) -> SourceRegistry:
    monkeypatch.setattr(registry_module, "DEVICES_FILE", tmp_path / "devices.json")
    return SourceRegistry()


async def test_phone_video_is_consumed(tmp_path, monkeypatch):
    """Regression: phones have no adapter, so their queue had no consumer and
    video never reached the models."""
    reg = fresh_registry(tmp_path, monkeypatch)
    seen = []

    class FakePerception:
        async def process_packet(self, packet):
            seen.append(packet.source_id)

    from app.perception import workers
    monkeypatch.setattr(workers.PerceptionManager, "instance", classmethod(lambda cls: FakePerception()))

    entry = reg.register(name="Phone", kind=SourceKind.VIDEO, adapter_type="browser_node", source_id="node-1")
    await reg.start_source("node-1")
    for _ in range(10):  # paced like a phone sending frames, not one burst
        await entry.enqueue(SourcePacket(source_id="node-1", kind=SourceKind.VIDEO, ts_capture=time.time(),
                                         payload=np.zeros((4, 4, 3), np.uint8)))
        await asyncio.sleep(0.005)
    await asyncio.sleep(0.05)
    await reg.stop_source("node-1")

    assert len(seen) == 10
    assert entry.dropped_frames == 0


async def test_devices_survive_restart_with_same_token(tmp_path, monkeypatch):
    reg = fresh_registry(tmp_path, monkeypatch)
    phone = reg.register(name="Gate phone", kind=SourceKind.VIDEO, adapter_type="browser_node", zone_id="gate",
                         source_id="node-1", lat=12.97, lng=77.59)

    restored = SourceRegistry()
    await restored.restore()
    again = restored.get("node-1")

    assert again is not None
    assert again.token == phone.token  # the phone's saved pairing link keeps working
    assert again.zone_id == "gate"
    assert (again.lat, again.lng) == (12.97, 77.59)
    assert again.capabilities == {"video": True, "audio": True, "speaker": True}
    assert restored.get_by_token(phone.token) is again
    await restored.stop_all()


async def test_deleted_device_is_forgotten(tmp_path, monkeypatch):
    reg = fresh_registry(tmp_path, monkeypatch)
    reg.register(name="Phone", kind=SourceKind.VIDEO, adapter_type="browser_node", source_id="node-1")
    reg.unregister("node-1")

    restored = SourceRegistry()
    await restored.restore()
    assert restored.all() == []
