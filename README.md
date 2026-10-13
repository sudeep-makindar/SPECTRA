# SPECTRA

**Multimodal crowd-safety intelligence that tells a control room where to look and why, before a crowd becomes a crush.**

SPECTRA watches CCTV, microphones and ordinary phones at the same time. It turns what it sees and hears into a live, explainable risk score for every zone of a venue. When the risk is real, it raises one alert with an evidence clip, a plain-language AI briefing, and a bilingual PA announcement. When it isn't, it stays quiet.

> SPECTRA is a decision-support prototype for human operators, not a certified life-safety system. It measures and reports its own false-alarm rate.

## Why

India's recent crowd disasters (Hathras 2024; Tirupati, the Kumbh and Bengaluru in 2025) all happened in places full of cameras. The missing piece was a system that could watch every feed at once, recognise rising density and distress early, and get an operator's attention without crying wolf.

Single-sensor products fail in opposite directions. Audio detectors page security for every song and firecracker. Vision detectors can't tell a happy dense crowd from a dangerous one. SPECTRA's core idea is **gated cross-modal fusion**: no single sensor can raise a CRITICAL alarm on its own, and independent sensors that agree compound into one.

## What it does

| | |
|---|---|
| **See** | YOLO person detection + per-camera ByteTrack → headcount → **people/m² and Fruin Level of Service** (A–F), crowd heading, heading chaos, people-down heuristic, occupancy heatmap |
| **Feel motion** | Farneback optical flow against each camera's *own* learned baseline (calibration window; spikes can't become the new normal) |
| **Hear** | Audio Spectrogram Transformer (AudioSet) threat groups: screams, gunshots, glass, alarms. **Whisper** distress keywords in English, Hindi, Tamil and Telugu ("help", "bachao", "madad", "காப்பாத்துங்க"…). Fireworks, crackers and drums suppress the gunshot trigger |
| **Fuse** | Per-zone gated fusion: per-sensor caps, debounced corroboration, hysteresis, a trend forecast ("CRITICAL in ~40 s"), and a ranked human-readable *why* |
| **Act** | Incidents with H.264 evidence clips (8 s before / 6 s after, heads anonymised), operator workflow (hotkeys **A**cknowledge / **E**scalate / **M**ute), audit log, printable report |
| **Brief** | **AI co-pilot** (any OpenAI-compatible LLM: Groq free tier by default, xAI Grok, OpenRouter, Gemini or a fully local Ollama): incident briefings with confidence, false-alarm check, SOP-grounded action checklist, PA announcements in **English and Hindi**, "Ask SPECTRA" Q&A, shift handover reports. It receives **signal metadata only**, never video or audio |
| **Connect** | Mac camera and mic in one click; phones join by **QR code** and also act as steward pagers (red screen and vibration when their zone alarms); RTSP/IP cameras; recorded video |
| **Prove** | Live p50/p95/p99 latency per stage, and an evaluation harness comparing SPECTRA with single-sensor detectors |

## Results

The evaluation harness (`make eval`) replays 9 scenarios × 40 randomized trials through the production fusion code:

| Detector (stress suite*) | Detection rate | False-alarm rate |
|---|---|---|
| Audio-only | 75% | 40% |
| Vision-only | 75% | 27% |
| Motion-only | 75% | 20% |
| Any-sensor OR | 100% | 80% |
| **SPECTRA gated fusion** | **100%** | **13%** |

\*Stress suite: 2× sensor noise, 15% random sensor dropout, held-out seed. Thresholds were tuned on the standard suite. Traces model sensor *evidence*, not raw footage. See the System page for the method, confusion matrix and limitations.

Measured on an Apple Silicon laptop (MPS): YOLO + ByteTrack ≈ 30 ms p50, optical flow ≈ 10 ms, capture → fused risk ≈ 35 ms p95, AST ≈ 250 ms per 2 s audio window, Whisper ≈ 300–500 ms only when speech is present.

## Architecture

```
Sources ── Mac cam/mic · phones (QR, WSS) · RTSP · video files
   │        latest-frame-wins queues, one inference in flight per camera
   ▼
Perception (on-device, asyncio.to_thread — no MPS fork locks)
   YOLO+ByteTrack ─ optical flow ─ AST ─ Whisper (speech-gated)
   ▼
FusionCore per zone (pure, shared with the eval harness)
   caps → debounced corroboration → noisy-OR ×1.2 → smoothing → hysteresis → forecast
   ▼
Incidents ── evidence clips · audit log ── AI co-pilot (metadata only)
   ▼
React dashboard (WebSocket 2 Hz) · phone pager · PDF report
```

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · demo script: [docs/DEMO.md](docs/DEMO.md)

## Quick start

```bash
make setup                      # Python deps (uv/pip) + npm install
cp .env.example .env            # optional: GROQ_API_KEY (free) or another provider for the AI co-pilot
./scripts/make_https.sh         # self-signed cert so phones can stream camera/mic

make dev-backend                # :8000 (models load in the background)
make dev-frontend               # https://localhost:5173
```

Then open **Devices** to add the Mac camera and pair phones by QR, and use **Drills** (top bar) to run scripted, clearly labelled simulations (gate surge, panic + "bachao", concert false-alarm test, gunshot, sensor blackout).

```bash
make test                       # unit tests incl. fusion safety properties
make eval                       # benchmark → data/eval/report.{json,md}
```

## Privacy & ethics

- All perception runs on the edge machine. Raw video and audio never leave it.
- The LLM receives structured numbers and short keyword transcripts only, and briefings fall back to offline templates with no network.
- Stored clips have every detected person's head region pixelated (aligned with the DPDP Act's data-minimisation principle). Retention is configurable.
- Simulated signals are flagged `SIM` everywhere they appear. The UI always shows "Decision-support prototype · Not a certified safety system".

## Limitations

- Pretrained models are not fine-tuned on crowd-disaster data; the fusion benchmark uses synthetic sensor-evidence traces.
- Headcount → density assumes non-overlapping cameras and a configured floor area per zone.
- The fallen-person heuristic is aspect-ratio based and noisy.
- Single-machine deployment.

## License notes

Ultralytics YOLO is AGPL-3.0. Deployments must comply or obtain a commercial licence. The AST model is BSD-licensed; Whisper is MIT.
