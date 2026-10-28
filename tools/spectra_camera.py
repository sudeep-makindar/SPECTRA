"""
SPECTRA camera — turns a laptop into a network camera, like a CCTV camera.

Serves this laptop's webcam and microphone on your Wi-Fi:
    http://<this-laptop>:<port>/          check page: live picture + the address for SPECTRA
    http://<this-laptop>:<port>/stream    live video (MJPEG)
    http://<this-laptop>:<port>/audio     live microphone (16 kHz WAV)

SPECTRA, on another computer, reads these and does all the AI. Nothing is
recorded or analysed here.

Run it by double-clicking "Start SPECTRA camera" (macOS: .command,
Windows: .bat), or:
    python3 spectra_camera.py --port 8081
Options: --port, --camera (0 = built-in), --no-audio, --width, --fps
Needs: pip install opencv-python sounddevice numpy
"""

from __future__ import annotations

import argparse
import queue
import socket
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import cv2
import numpy as np

SAMPLE_RATE = 16000


def lan_ip() -> str:
    """The address other devices on this Wi-Fi use to reach this laptop."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))  # no packet is sent; this just picks the Wi-Fi interface
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


class Camera:
    """Reads the webcam on a thread and keeps the newest frame as JPEG."""

    def __init__(self, index: int, width: int, fps: int):
        self.cap = cv2.VideoCapture(index)
        if not self.cap.isOpened():
            sys.exit("Could not open the camera. On a Mac, allow camera access for Terminal in "
                     "System Settings → Privacy & Security → Camera, then try again.")
        self.width, self.interval = width, 1.0 / fps
        self.jpeg: bytes | None = None
        self.frame_id = 0
        self.new_frame = threading.Condition()
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self) -> None:
        while True:
            t0 = time.time()
            ok, frame = self.cap.read()
            if not ok:
                time.sleep(0.2)
                continue
            if frame.shape[1] > self.width:
                frame = cv2.resize(frame, (self.width, int(frame.shape[0] * self.width / frame.shape[1])))
            jpeg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])[1].tobytes()
            with self.new_frame:
                self.jpeg, self.frame_id = jpeg, self.frame_id + 1
                self.new_frame.notify_all()
            time.sleep(max(0.0, self.interval - (time.time() - t0)))


class Microphone:
    """Captures 16 kHz mono PCM and fans it out to every connected listener."""

    def __init__(self):
        import sounddevice as sd
        self.listeners: set[queue.Queue] = set()
        self.lock = threading.Lock()
        self.stream = sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype="int16",
                                     blocksize=SAMPLE_RATE // 10, callback=self._on_audio)
        self.stream.start()

    def _on_audio(self, indata, frames, t, status) -> None:
        chunk = indata[:, 0].tobytes()
        with self.lock:
            for q in self.listeners:
                if q.qsize() < 50:  # a slow listener drops audio instead of growing memory
                    q.put_nowait(chunk)

    def listen(self) -> queue.Queue:
        q: queue.Queue = queue.Queue()
        with self.lock:
            self.listeners.add(q)
        return q

    def stop_listening(self, q: queue.Queue) -> None:
        with self.lock:
            self.listeners.discard(q)


def wav_header() -> bytes:
    """A WAV header for an endless 16-bit mono stream (sizes set to the maximum)."""
    byte_rate = SAMPLE_RATE * 2
    return (b"RIFF" + (0xFFFFFFFF).to_bytes(4, "little") + b"WAVE"
            + b"fmt " + (16).to_bytes(4, "little") + (1).to_bytes(2, "little") + (1).to_bytes(2, "little")
            + SAMPLE_RATE.to_bytes(4, "little") + byte_rate.to_bytes(4, "little")
            + (2).to_bytes(2, "little") + (16).to_bytes(2, "little")
            + b"data" + (0xFFFFFFFF).to_bytes(4, "little"))


def make_handler(camera: Camera, mic: Microphone | None, address: str):
    page = f"""<!doctype html><meta name=viewport content="width=device-width">
<title>SPECTRA camera</title>
<body style="margin:0;background:#0d0d0e;color:#f4f3f0;font:16px -apple-system,system-ui,sans-serif">
<div style="max-width:900px;margin:0 auto;padding:24px">
<h1 style="font-size:24px">SPECTRA camera is streaming</h1>
<p>In SPECTRA: <b>Devices → Add device → Another laptop</b>, and enter
<code style="background:#222;padding:3px 8px;border-radius:6px">{address}</code></p>
<img src="/stream" style="width:100%;border-radius:12px;background:#000">
<p style="color:#8e8c87">Microphone: {"on (/audio)" if mic else "off"}. Keep this window open while streaming.</p>
</div>"""

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):  # quiet: only print who connects
            pass

        def do_GET(self):
            if self.path in ("/", "/index.html"):
                body = page.encode()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            elif self.path.startswith("/stream"):
                self._stream_video()
            elif self.path.startswith("/audio") and mic:
                self._stream_audio()
            else:
                self.send_error(404)

        def _stream_video(self):
            print(f"  video → {self.client_address[0]}")
            self.send_response(200)
            self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            last = -1
            try:
                while True:
                    with camera.new_frame:
                        camera.new_frame.wait_for(lambda: camera.frame_id != last, timeout=2)
                        jpeg, last = camera.jpeg, camera.frame_id
                    if jpeg:
                        self.wfile.write(b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
                                         + str(len(jpeg)).encode() + b"\r\n\r\n" + jpeg + b"\r\n")
            except (BrokenPipeError, ConnectionResetError):
                print(f"  video ✕ {self.client_address[0]}")

        def _stream_audio(self):
            print(f"  audio → {self.client_address[0]}")
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            q = mic.listen()
            try:
                self.wfile.write(wav_header())
                while True:
                    self.wfile.write(q.get())
            except (BrokenPipeError, ConnectionResetError):
                print(f"  audio ✕ {self.client_address[0]}")
            finally:
                mic.stop_listening(q)

    return Handler


def main() -> None:
    ap = argparse.ArgumentParser(description="Stream this laptop's camera and microphone for SPECTRA.")
    ap.add_argument("--port", type=int, default=8081, help="port to stream on (default 8081)")
    ap.add_argument("--camera", type=int, default=0, help="camera number (0 = built-in)")
    ap.add_argument("--no-audio", action="store_true", help="video only")
    ap.add_argument("--width", type=int, default=960, help="maximum picture width")
    ap.add_argument("--fps", type=int, default=15, help="frames per second")
    args = ap.parse_args()

    camera = Camera(args.camera, args.width, args.fps)
    mic = None
    if not args.no_audio:
        try:
            mic = Microphone()
        except Exception as exc:
            print(f"Microphone unavailable ({exc}); streaming video only.")

    ip = lan_ip()
    address = f"{ip}:{args.port}"
    server = ThreadingHTTPServer(("0.0.0.0", args.port), make_handler(camera, mic, address))
    server.daemon_threads = True
    print()
    print("  SPECTRA camera is streaming")
    print(f"  In SPECTRA, add device → Another laptop → {address}")
    print(f"  Check the picture: http://{address}/")
    print(f"  Video: http://{address}/stream    Audio: {'http://' + address + '/audio' if mic else 'off'}")
    print("  Press Ctrl+C (or close this window) to stop.")
    print()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Stopped.")


if __name__ == "__main__":
    main()
