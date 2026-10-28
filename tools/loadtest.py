"""
SPECTRA load test — can this computer handle your demo?

Starts fake network cameras (MJPEG, like IP Webcam and the camera script)
and fake microphones (WAV) on this computer, adds them to the running
SPECTRA, measures for a while, prints whether every camera and mic keeps
up, then removes them again.

    # SPECTRA must already be running (Start SPECTRA.bat / make dev-backend)
    python tools/loadtest.py                 # 4 cameras + 4 mics, 30 s
    python tools/loadtest.py --cams 6 --mics 4 --seconds 60

Run it with the backend's Python (it needs opencv-python and numpy).
"""

from __future__ import annotations

import argparse
import json
import socketserver
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

import cv2
import numpy as np

SPECTRA = "http://localhost:8000"
CAM_FPS = 15  # like a phone or laptop camera
SAMPLE_RATE = 16000


def call(path: str, body: dict | None = None, method: str | None = None):
    req = urllib.request.Request(SPECTRA + path, json.dumps(body).encode() if body else None,
                                 {"Content-Type": "application/json"}, method=method)
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.load(r)


class _Server(socketserver.ThreadingMixIn, HTTPServer):
    daemon_threads = True


def fake_camera(port: int, seed: int) -> _Server:
    """MJPEG stream of moving figures, so the detector and tracker do real work."""
    rng = np.random.default_rng(seed)
    people = rng.uniform([40, 120], [600, 300], size=(6, 2))
    velocity = rng.uniform(-6, 6, size=(6, 2))

    def frame() -> bytes:
        nonlocal people
        people = np.clip(people + velocity, [20, 100], [620, 320])
        img = np.full((480, 640, 3), 70, np.uint8)
        for x, y in people.astype(int):
            cv2.circle(img, (x, y - 50), 16, (180, 160, 150), -1)       # head
            cv2.rectangle(img, (x - 20, y - 32), (x + 20, y + 60), (90, 60, 140), -1)  # body
        return cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 75])[1].tobytes()

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
            self.end_headers()
            try:
                while True:
                    jpg = frame()
                    self.wfile.write(b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: %d\r\n\r\n" % len(jpg) + jpg + b"\r\n")
                    time.sleep(1 / CAM_FPS)
            except (BrokenPipeError, ConnectionResetError):
                pass

    srv = _Server(("127.0.0.1", port), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def fake_microphone(port: int, seed: int) -> _Server:
    """Endless 16 kHz WAV: crowd-like noise with bursts, so the sound model runs every window."""
    rng = np.random.default_rng(seed)
    header = (b"RIFF" + (0xFFFFFFFF).to_bytes(4, "little") + b"WAVEfmt " + (16).to_bytes(4, "little")
              + (1).to_bytes(2, "little") + (1).to_bytes(2, "little") + SAMPLE_RATE.to_bytes(4, "little")
              + (SAMPLE_RATE * 2).to_bytes(4, "little") + (2).to_bytes(2, "little") + (16).to_bytes(2, "little")
              + b"data" + (0xFFFFFFFF).to_bytes(4, "little"))

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.end_headers()
            try:
                self.wfile.write(header)
                while True:
                    chunk = rng.normal(0, 0.05, SAMPLE_RATE // 10)
                    if rng.random() < 0.1:
                        chunk *= 6  # a loud moment
                    self.wfile.write((np.clip(chunk, -1, 1) * 32767).astype("<i2").tobytes())
                    time.sleep(0.1)
            except (BrokenPipeError, ConnectionResetError):
                pass

    srv = _Server(("127.0.0.1", port), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def main() -> None:
    ap = argparse.ArgumentParser(description="Check whether this computer keeps up with your cameras and mics.")
    ap.add_argument("--cams", type=int, default=4)
    ap.add_argument("--mics", type=int, default=4)
    ap.add_argument("--seconds", type=int, default=30, help="how long to measure (after a 15 s warm-up)")
    args = ap.parse_args()

    try:
        health = call("/api/health")
    except OSError:
        raise SystemExit("SPECTRA isn't running on this computer. Start it first, then run the load test.")
    device = health["device"]
    gpu = device.get("gpu_name") or device["selected_device"]
    print(f"\nSPECTRA on {gpu} · models: " + ", ".join(f"{m['key']} {m['status']}" for m in health["models"]))
    if any(m["status"] != "loaded" for m in health["models"]):
        raise SystemExit("Wait until every model shows 'loaded' (about 20 s after start), then run again.")

    added: list[str] = []
    servers = []
    try:
        for i in range(args.cams):
            servers.append(fake_camera(18100 + i, i))
            added.append(call("/api/sources", {"name": f"Load test camera {i + 1}", "adapter": "rtsp_http",
                                                "url": f"http://127.0.0.1:{18100 + i}/stream"})["id"])
        for i in range(args.mics):
            servers.append(fake_microphone(18200 + i, 100 + i))
            added.append(call("/api/sources", {"name": f"Load test mic {i + 1}", "adapter": "http_audio",
                                                "url": f"http://127.0.0.1:{18200 + i}/audio"})["id"])

        print(f"Added {args.cams} cameras and {args.mics} mics. Warming up for 15 s…")
        time.sleep(15)
        print(f"Measuring for {args.seconds} s…")
        time.sleep(args.seconds)
        end = {s["id"]: s for s in call("/api/sources") if s["id"] in added}
        metrics = call("/api/metrics")
    finally:
        for sid in added:
            try:
                call(f"/api/sources/{sid}", method="DELETE")
            except OSError:
                pass
        for srv in servers:
            srv.shutdown()

    target = 5  # SPECTRA analyses 5 frames a second per camera
    print(f"\n{'Source':24} {'In':>8} {'Analysed':>10}   Result")
    ok_all = True
    for sid in added:
        s = end.get(sid)
        if not s:
            continue
        is_cam = s["kind"] == "video"
        ai = s["inference_fps"]
        need = 0.8 * target if is_cam else 0.8  # mics: one 2 s window analysed per second
        ok = ai >= need and s["status"] == "online"
        ok_all &= ok
        unit = "fps" if is_cam else "/s"
        print(f"{s['name']:24} {s['fps']:>5} {unit:>2} {ai:>7} {unit:>2}   {'keeps up' if ok else 'FALLING BEHIND'}")

    lat = metrics.get("latencies", {})
    print("\nTime per item (median / slowest 5%):")
    for key, label in (("vision", "Person detection"), ("motion", "Movement"), ("audio", "Sound model"),
                       ("whisper", "Speech (Whisper)"), ("e2e", "Camera → risk score")):
        st = lat.get(key) or {}
        if st.get("p50") is not None:
            print(f"  {label:22} {st['p50']:>7.0f} ms / {st['p95']:>6.0f} ms")
    sysm = metrics.get("system", {})
    if sysm:
        print(f"\nCPU {sysm.get('cpu_percent', '?')}% · RAM {sysm.get('ram_percent', '?')}% used")

    print("\n" + ("✅ This computer keeps up with this many cameras and mics."
                  if ok_all else
                  "⚠️  Some sources fall behind. Options, in backend/config/app.yaml:\n"
                  "   video.yolo_model: yolo26n.pt   (≈3× faster person detection)\n"
                  "   video.analysis_fps: 3          (analyse fewer frames per camera)\n"
                  "   or run SPECTRA on a computer with an NVIDIA GPU."))


if __name__ == "__main__":
    main()
