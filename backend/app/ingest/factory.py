"""
Adapter factory — builds the right ingest adapter for a device type.

Shared by the API (adding a device) and the registry (restoring saved devices
on startup), so a restored device is rebuilt exactly as it was created.

Token devices have no server-side adapter: they connect to /ws/node with their
pairing token and push frames and audio themselves. Today that is
browser_node, a phone or laptop running the /node page.

Network cameras are pulled instead, like CCTV: rtsp_http reads their video
and http_audio their WAV audio. That covers the Android IP Webcam app
(:8080/video, :8080/audio.wav) and tools/spectra_camera.py (/stream, /audio).
"""

from __future__ import annotations

from typing import Optional

from app.ingest.base import BaseSource, SourceKind

TOKEN_ADAPTERS = {"browser_node"}

DEFAULT_CAPABILITIES: dict[str, dict[str, bool]] = {
    "webcam": {"video": True, "audio": False, "speaker": False},
    "local_mic": {"video": False, "audio": True, "speaker": False},
    "browser_node": {"video": True, "audio": True, "speaker": True},
    "rtsp_http": {"video": True, "audio": False, "speaker": False},
    "http_audio": {"video": False, "audio": True, "speaker": False},
    "file_loop": {"video": True, "audio": False, "speaker": False},
    "simulated": {"video": True, "audio": False, "speaker": False},
}

ID_PREFIX = {
    "webcam": "cam", "local_mic": "mic", "browser_node": "node",
    "rtsp_http": "rtsp", "http_audio": "netmic", "file_loop": "file", "simulated": "sim",
}


class AdapterError(ValueError):
    """The request can't be turned into a working adapter."""


def build_adapter(adapter_type: str, source_id: str, name: str,
                  url: Optional[str] = None, config: Optional[dict] = None) -> Optional[BaseSource]:
    """Return a ready-to-start adapter, or None for token devices."""
    config = config or {}
    fps = config.get("fps", 5)

    if adapter_type in TOKEN_ADAPTERS:
        return None
    if adapter_type == "file_loop":
        if not url:
            raise AdapterError("A recorded video needs a file path")
        from app.ingest.adapters import FileLoopSource
        return FileLoopSource(source_id=source_id, name=name, file_path=url, target_fps=fps)
    if adapter_type == "rtsp_http":
        if not url:
            raise AdapterError("An IP camera needs a stream address")
        from app.ingest.adapters import RtspHttpVideoSource
        return RtspHttpVideoSource(source_id=source_id, name=name, url=url, target_fps=fps)
    if adapter_type == "http_audio":
        if not url:
            raise AdapterError("A network microphone needs an audio stream address")
        from app.ingest.adapters import HttpAudioSource
        return HttpAudioSource(source_id=source_id, name=name, url=url)
    if adapter_type == "webcam":
        from app.ingest.adapters import LocalWebcamSource
        return LocalWebcamSource(source_id=source_id, name=name,
                                 device_index=config.get("device_index", 0), target_fps=fps)
    if adapter_type == "local_mic":
        from app.ingest.adapters import LocalMicSource
        return LocalMicSource(source_id=source_id, name=name, device=config.get("device"))
    if adapter_type == "simulated":
        from app.ingest.adapters import SimulatedSource
        return SimulatedSource(source_id=source_id, name=name, target_fps=fps)
    raise AdapterError(f"Unknown device type: {adapter_type}")


def kind_for(adapter_type: str, capabilities: dict[str, bool]) -> SourceKind:
    """Video if the device sends pictures, otherwise audio (mics and speakers)."""
    if adapter_type in ("local_mic", "http_audio"):
        return SourceKind.AUDIO
    return SourceKind.VIDEO if capabilities.get("video", True) else SourceKind.AUDIO
