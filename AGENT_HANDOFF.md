# ⚡ Status update — Phase 5 complete (supersedes sections 4 and 6 below where they conflict)

Sections 4–6 below were written before Phase 5 and overstated what worked
(the live pipeline crashed in `record_latency`, ByteTrack's `lap` dep was missing,
zones/incidents pages were stubs). As of Phase 5:

- **Fusion**: `backend/app/fusion/core.py` is the pure, tested gated-fusion logic
  (caps, debounced corroboration, hysteresis, forecast), shared by the engine and
  the eval harness. `tests/test_fusion.py` pins its safety properties.
- **Zones** (`app/zones/manager.py`, persisted to `data/zones.json`) carry floor area → people/m² → Fruin LoS.
- **Incidents** (`app/incidents/store.py`, JSON per incident in `data/incidents/`), evidence clips with head anonymisation.
- **Claude co-pilot** (`app/ai/copilot.py`, `claude-opus-5-5`, metadata only, template fallback). Key in `.env` as `ANTHROPIC_API_KEY`.
- **Scenario director** (`app/scenarios/director.py`), **eval harness** (`app/evaluation/harness.py`, CLI `python -m tests.eval_harness`).
- **Frontend**: single `SpectraProvider` WebSocket (`src/context/SpectraContext.tsx`), shared types in `src/lib/types.ts`.
  Series colours were validated for CVD/contrast; risk tiers use the reserved status palette.
- **Phones**: `scripts/make_https.sh` → Vite serves HTTPS on the LAN; pair via QR in "Connect device".
- Demo script: `docs/DEMO.md`.

Next candidates: per-zone threshold overrides from the UI, session recording + deterministic replay,
fine-tuned audio adapter (Phase 7), ONVIF discovery.

---

# SPECTRA — Comprehensive Agent Handoff & Knowledge Base

> **CONFIDENTIAL & INTERNAL DEVELOPER REFERENCE**  
> **Repository:** [https://github.com/sudeep-makindar/SPECTRA](https://github.com/sudeep-makindar/SPECTRA)  
> **Branch:** `main`  
> **Current Version:** Phase 4 Complete (Moving to Phase 5)  
> **Target Audience:** Incoming AI Agent / Lead Engineer continuing system development.

---

## 1. Executive Mission & Project Context

### 1.1 What is Spectra?
**Spectra** is a real-time, multimodal crowd-safety intelligence platform designed for venue control rooms, event security directors, and public safety teams. Rather than relying on siloed CCTV feeds or isolated decibel meters, Spectra continuously ingests and correlates three distinct modalities:
1. **Vision:** Real-time crowd density headcounts, directional velocity vectors, and fall/collapse detection.
2. **Motion:** Dense optical-flow anomaly detection against dynamic historical baselines (sudden stampedes, crowd scattering, or directional turbulence).
3. **Audio:** Acoustic threat classification (screams, gunshots, explosions) combined with natural language distress keyword spotting ("help", "stop", "fire", "gun").

### 1.2 Core Problem Solved
In real-world crowd safety:
- **Audio-only detectors** trigger countless false alarms on harmless laughter, stage pyrotechnics, and music bass drops.
- **Vision-only detectors** cannot distinguish a cheerful dense festival crowd from a dangerous bottleneck crush.
- **Spectra solves this via Cross-Modal Fusion:** Single-modality spikes are filtered and dampened. However, when an acoustic scream correlates with an optical-flow crowd scatter and a dense gate bottleneck, the Fusion Engine applies a cross-modal multiplier, immediately escalating risk, alerting operators, and capturing forensic video clips.

### 1.3 Key Architectural & Ethical Principles
- **Decision-Support Prototype:** Spectra is an advisory tool for human operators, not an autonomous life-safety system. It explicitly reports confidence scores, uncertainty, and potential false positives.
- **Zero Cloud Video/Audio Exfiltration:** Ingestion, inference, optical flow, and audio classification run **100% locally on the edge machine**. No raw frames or audio streams ever leave the local network.
- **Explainable Risk:** Every alert surfaces a human-readable "why" (e.g., *"Elevated crowd density (82%) + sudden scatter velocity with distress keyword 'help' spotted"*).

---

## 2. Design System & Aesthetics ("Stoken" Crypto Aesthetic)

The user interface adheres strictly to a sleek, dark-canvas crypto-wallet aesthetic ("Stoken"):
- **Base Canvas:** Deep Charcoal `#0C0C0F` with soft radial vignette gradients.
- **Card Framing:** Bento-grid modular layout with generous `24px` and `32px` border radii (`rounded-3xl` / `.stoken-card`).
- **Glassmorphism:** Frosted surface blurs (`backdrop-blur-md`, background `rgba(27, 27, 31, 0.75)`, subtle border `rgba(255, 255, 255, 0.08)`).
- **Curated Color Palette:**
  - **Lavender Accent:** `#9D8DF7` / `rgba(157, 141, 247, 1)` — Primary focus, active tabs, brand highlights.
  - **Sage Green:** `#6E9A76` — Normal/safe states, system operational indicators.
  - **Warm Cream:** `#F2F2EE` — High-contrast numerals, critical metrics.
  - **Charcoal Surface:** `#1B1B1F` — Card containers and nested panels.
  - **Alert Amber:** `#FFB020` — Elevated risk status.
  - **Critical Crimson:** `#FF5C5C` — High/Critical risk status and recording badges.
- **Typography:**
  - Display Headers: `Anton`, `Impact`, sans-serif (punchy, high-impact numbers and card headers).
  - UI / Monospace: `Space Grotesk`, `JetBrains Mono`, system monospace.
- **Brand Identity:** Geometric SVG Prism Wordmark representing vision, motion, and sound refraction (`frontend/src/components/Logo.tsx`).

---

## 3. Full Repository Map & Architecture

```
SPECTRA/
├── backend/
│   ├── app/
│   │   ├── api/
│   │   │   ├── routes.py          # REST endpoints (/api/status, /api/sources, /api/zones)
│   │   │   └── incidents.py       # REST endpoints (/api/incidents, /api/incidents/{filename})
│   │   ├── core/
│   │   │   ├── config.py          # Pydantic v2 application configuration loader
│   │   │   ├── logging.py         # Structured logging configuration
│   │   │   ├── metrics.py         # In-memory Prometheus-style metrics collector
│   │   │   └── device.py          # Hardware acceleration detector (Apple MPS / CUDA / CPU)
│   │   ├── db/
│   │   │   ├── session.py         # SQLite database session and table initialization
│   │   │   └── models.py          # SQLAlchemy models (Incident, SourceRecord, Alert)
│   │   ├── evidence/
│   │   │   └── manager.py         # Rolling video ring buffer (deque) & MP4 incident recorder
│   │   ├── fusion/
│   │   │   ├── schema.py          # Pydantic models: ModalityState, ZoneState, SystemState
│   │   │   └── engine.py          # Cross-modal fusion engine, hysteresis state machine
│   │   ├── ingest/
│   │   │   ├── base.py            # Base SourceAdapter & SourcePacket definitions
│   │   │   ├── adapters.py        # Simulated, RTSP/OpenCV, and browser WebSocket adapters
│   │   │   └── registry.py        # Central source registry, frame dispatch, staleness monitor
│   │   ├── models/
│   │   │   ├── registry.py        # BaseModel abstract interface and ModelRegistry singleton
│   │   │   ├── vision.py          # Ultralytics YOLO26/11 + ByteTrack tracking & chaos index
│   │   │   ├── motion.py          # OpenCV Farneback optical flow with EMA dynamic baseline
│   │   │   └── audio.py           # MIT Audio Spectrogram Transformer (AST) + Whisper tiny
│   │   ├── perception/
│   │   │   ├── schema.py          # RiskSample, VisionPayload, AudioPayload
│   │   │   └── workers.py         # Async perception dispatch layer (asyncio.to_thread)
│   │   ├── ws/
│   │   │   └── handlers.py        # WebSockets: /ws/live (metrics/zones), /ws/preview, /ws/node
│   │   └── main.py                # FastAPI lifecycle, startup hooks, router mounts
│   ├── config/
│   │   ├── app.yaml               # Server, video, audio, storage settings
│   │   └── fusion.yaml            # Modality weights, thresholds, hysteresis parameters
│   └── tests/                     # Unit and integration test suites
├── data/
│   ├── incidents/                 # Recorded MP4 video clips from critical incidents
│   └── spectra.db                 # SQLite persistent database
├── docs/
│   ├── ARCHITECTURE.md            # Detailed system architectural specification
│   ├── DECISIONS.md               # Architecture Decision Records (ADRs)
│   ├── ROADMAP.md                 # Long-term feature roadmap
│   └── retros/                    # Retrospectives for completed phases
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Sidebar.tsx        # Stoken-style navigation bar with active indicators
│   │   │   ├── Logo.tsx           # Spectra SVG Prism Wordmark
│   │   │   └── IncidentReplayModal.tsx # Video playback modal for recorded incidents
│   │   ├── pages/
│   │   │   ├── OverviewPage.tsx   # Bento-grid dashboard (Dials, Recharts sparklines, Zones)
│   │   │   ├── LiveOpsPage.tsx    # Live multi-camera tile view and preview feeds
│   │   │   ├── ZonesPage.tsx      # Spatial zone configuration and sensor mappings
│   │   │   ├── IncidentsPage.tsx  # Incident log table with video replay triggers
│   │   │   ├── SystemPage.tsx     # Hardware metrics, memory, FPS, and model telemetry
│   │   │   └── NodePage.tsx       # Edge device client (/node) for streaming phone camera/mic
│   │   ├── App.tsx                # React Router setup and layout shell
│   │   └── index.css              # Tailwind CSS v4 & custom Stoken glassmorphism tokens
│   ├── package.json
│   └── vite.config.ts
└── AGENT_HANDOFF.md               # This reference file
```

---

## 4. Completed Phases & Implemented Features (Phases 0 – 4)

### Phase 0: Scaffolding, Design Tokens & Project Foundation
- **Frontend:** React 19 + TypeScript + Vite + Tailwind CSS v4. Configured custom font imports (`Space Grotesk`, `Anton`), CSS variables for Stoken tokens, and responsive layout shells.
- **Backend:** FastAPI with Pydantic v2 settings loader (`backend/app/core/config.py`).
- **Telemetry:** In-memory Prometheus-style metrics engine (`MetricsCollector`) tracking FPS, latency, and queue depths.

### Phase 1: Ingestion Engine & Source Registry
- **Source Registry (`backend/app/ingest/registry.py`):** Unified catalog handling multiple concurrent video and audio feeds.
- **Supported Ingest Adapters (`backend/app/ingest/adapters.py`):**
  - `SimulatedSource`: Generates realistic procedural crowd frames and synthetic waveforms for local testing without physical cameras.
  - `CvVideoSource`: Ingests RTSP network streams or local `.mp4` video files.
  - `WebSocketSource`: Ingests raw video/audio packets transmitted from edge browser nodes (`/ws/node`).
- **Live Preview Streaming:** WebSocket endpoint `/ws/preview/{source_id}` pushes low-latency JPEG previews to frontend canvas elements.
- **Staleness Monitor:** Automatically detects dropped streams or network partitions, tagging feeds as `DEGRADED` or `OFFLINE`.

### Phase 2: Multimodal Perception Layer
- **Vision Model (`backend/app/models/vision.py`):**
  - Ultralytics YOLO (targeting `class=0`: person) for accurate headcount and bounding-box tracking.
  - Integrated **ByteTrack** for frame-to-frame trajectory estimation.
  - Computes:
    - **Crowd Density Score:** Ratio of detected people to maximum zone capacity.
    - **Mean Velocity Vector:** Measures directional momentum and crowd run speeds.
    - **Spatial Chaos Index:** Variance in heading angles (detects scattering or cross-directional panic).
    - **Fallen Person Heuristic:** Flags bounding boxes where `width > height * 1.3`.
- **Motion Model (`backend/app/models/motion.py`):**
  - OpenCV Farneback dense optical flow calculated on downscaled frames (320x180) for low-overhead motion vectors.
  - Maintained rolling Exponential Moving Average (EMA) baseline per camera source.
  - Emits anomaly spikes when sudden crowd movements significantly exceed historical baseline motion.
- **Audio Dual-Model Topology (`backend/app/models/audio.py`):**
  - **MIT Audio Spectrogram Transformer (AST):** Checkpoint `MIT/ast-finetuned-audioset-10-10-0.4593` categorizing high-risk acoustic sounds (Screams, Gunshots, Explosions).
  - **OpenAI Whisper (`tiny`):** Transcribes audio windows to flag spoken distress keywords ("help", "stop", "gun", "fire", "police").
- **Threading & GIL Design:**
  - Instead of brittle Python `multiprocessing.Process` (which triggers memory locks on macOS MPS), inference runs via `asyncio.to_thread()`. Because PyTorch and OpenCV drop the GIL during tensor computations, this achieves full concurrent performance.

### Phase 3: Spatial Zones & Cross-Modal Fusion Engine
- **Data Models (`backend/app/fusion/schema.py`):** Structured schemas for `ModalityState`, `ZoneState`, and `SystemState`.
- **Fusion Engine (`backend/app/fusion/engine.py`):**
  - Merges vision, motion, and audio scores per spatial zone.
  - **Cross-Modal Confirmation Multiplier:** When multiple modalities spike simultaneously (e.g., vision density > 0.6 AND audio scream > 0.5), risk score is boosted by `1.4x`.
  - **Hysteresis State Machine:** Four operational tiers: `NORMAL` (0.0-0.3), `ELEVATED` (0.3-0.6), `HIGH` (0.6-0.8), `CRITICAL` (0.8-1.0). Distinct upward and downward thresholds prevent rapid alert toggling.
  - **Hard-Trigger Overrides:** Instant escalation to `CRITICAL` upon high-confidence gunshot or explosion detection.
- **Frontend Overview Dashboard (`frontend/src/pages/OverviewPage.tsx`):**
  - Connected to live backend WebSocket `/ws/live`.
  - Circular SVG dials displaying live Zone Risk.
  - Responsive **Recharts** sparklines visualizing 30-second trailing windows for crowd density and acoustic threats.

### Phase 4: Alerts, Rolling Video Buffers & Incident Replay
- **Evidence Manager (`backend/app/evidence/manager.py`):**
  - Maintains in-memory `collections.deque` ring buffers retaining the last 15 seconds of raw video frames for each video source.
  - When the Fusion Engine transitions into `CRITICAL`, it dispatches an async task to dump the buffer and encode it into an MP4 video file inside `data/incidents/` (`{zone_id}_{source_id}_{YYYYMMDD_HHMMSS}.mp4`).
- **Incidents REST API (`backend/app/api/incidents.py`):**
  - `GET /api/incidents/`: Lists recorded incidents with timestamps, zones, and file sizes.
  - `GET /api/incidents/{filename}`: Streams recorded MP4 videos with HTTP Range support.
- **Incident Replay Modal (`frontend/src/components/IncidentReplayModal.tsx`):**
  - Directly accessible from the "INCIDENT REPLAY" card on the dashboard.
  - Features interactive clip selection, live HTML5 video player, and evidence timestamps.

---

## 5. Development Setup & Operational Guide

### 5.1 Prerequisites
- **macOS / Linux** with Python 3.10+ (MPS acceleration supported on Apple Silicon).
- **Node.js** 18+ and `npm`.
- **FFmpeg** installed on the system (for OpenCV video encoding).

### 5.2 Starting the Backend
```bash
cd backend
source .venv/bin/activate
# Install requirements if needed: pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```
- API Documentation (Swagger): `http://localhost:8000/docs`
- Health Check: `http://localhost:8000/api/status`
- WebSocket Live Feed: `ws://localhost:8000/ws/live`

### 5.3 Starting the Frontend
```bash
cd frontend
npm install
npm run dev
```
- Dashboard URL: `http://localhost:5173`
- Edge Node Client: `http://localhost:5173/node`

### 5.4 Configuration Files
- **`backend/config/app.yaml`:**
  - `sim_mode: true` (set to `true` for simulated demo sources; `false` for live RTSP/CCTV).
  - Video FPS targets, audio sample rates (16kHz), evidence buffer duration (`15s`).
- **`backend/config/fusion.yaml`:**
  - Modality weights (e.g., `vision: 0.4`, `motion: 0.3`, `audio: 0.3`).
  - Hysteresis thresholds and cross-modal multiplier constants.

---

## 6. What Needs to Be Built Next (Phases 5 – 7)

### 📌 PRIORITY 1: Phase 5 — Metrics, Benchmarks & Evaluation Harness
1. **Frontend Metrics Dashboard (`frontend/src/pages/SystemPage.tsx` or `MetricsPage.tsx`):**
   - Connect to `/api/metrics` and display live system telemetry:
     - End-to-end inference latency percentiles (P50, P95, P99).
     - FPS processed per camera vs. camera capture rate.
     - Frame queue depth and drop rate.
     - System memory and GPU/MPS utilization.
2. **Evaluation Harness (`backend/tests/eval_harness.py`):**
   - Create an automated benchmark runner that feeds pre-recorded video/audio test clips (normal flow, crowd crush, scream, ambient music) through the pipeline.
   - Output an evaluation report containing:
     - Detection latency (time from event onset to alert trigger).
     - False alarm rejection rate (e.g., verifying loud music or dancing does NOT trigger critical alerts).
     - Confusion matrix across risk tiers.

### 📌 PRIORITY 2: Phase 6 — Scenario Simulation Presets & Operator Workflow
1. **Interactive Simulation Presets (`backend/app/ingest/adapters.py` + UI):**
   - Add triggerable test scenarios accessible via UI buttons on the dashboard or `/system`:
     - *Scenario A: Normal Venue Flow* (steady pedestrian velocity, low acoustic noise).
     - *Scenario B: Gate Congestion Surge* (density climbs to 90%, velocity drops to 0.1).
     - *Scenario C: Panic Scatter & Distress* (sudden high velocity dispersion, scream acoustic event, keyword "help").
     - *Scenario D: Sensor Failure / Blind Spot* (simulate camera disconnection to verify degraded-mode handling).
2. **Operator Control Room Workflow:**
   - Keyboard hotkeys (`A` to acknowledge alert, `E` to escalate to event lead, `J`/`K` to navigate incidents).
   - Zone Blind Spot Warning indicator when a zone has all sources offline.
   - Audio tone alert on `CRITICAL` trigger with a global mute toggle.

### 📌 PRIORITY 3: Phase 7 — Fine-Tuning & Custom Domain Adapters
1. **Custom Audio Adapter Script (`scripts/train_audio_adapter.py`):**
   - Provide a training script using PyTorch to fine-tune AST or train a lightweight classifier on domain-specific scream and gunshot datasets.
2. **Camera Calibration Mode:**
   - In the first 60 seconds of a new camera stream, automatically calculate the baseline optical flow and density variance to adjust anomaly thresholds dynamically.
3. **ONVIF / RTSP Auto-Discovery:**
   - Add network probe utility for auto-discovering IP cameras on local subnet.

---

## 7. Critical Technical Constraints & Rules for the Incoming Agent

1. **Aesthetic Consistency is Mandatory:**
   - Do not revert to default browser tables, standard blue buttons, or plain unstyled inputs.
   - Retain the Stoken palette (Lavender, Sage, Cream, Charcoal), rounded card borders (`rounded-2xl` / `rounded-3xl`), and subtle micro-animations.
2. **Concurrency & Hardware Safety:**
   - Never use `multiprocessing.Process` for PyTorch/OpenCV workers on macOS. Always use `asyncio.to_thread` to prevent MPS context fork locks.
3. **Local Privacy Enforcement:**
   - Do not introduce cloud API dependencies (e.g., external OpenAI API endpoints) for live inference. All perception models (YOLO, AST, Whisper) must execute locally.
4. **Git Discipline:**
   - After completing any significant milestone or phase, create clean commits and push directly to `origin/main` on GitHub:
     ```bash
     git add .
     git commit -m "Phase X: <Description of work done>"
     git push origin main
     ```

---

## 8. Plug-and-Play Prompt for the Next Agent

When opening a new agent session, copy and paste the prompt below:

```text
Hello! I am continuing development of the SPECTRA project in this session.
Please thoroughly read the handoff file `AGENT_HANDOFF.md` and `docs/ARCHITECTURE.md` in the workspace root.

Project Summary:
Spectra is a real-time multimodal crowd-safety intelligence platform (Vision + Motion + Audio) built with FastAPI, PyTorch (YOLO26 + ByteTrack, AST, Whisper), OpenCV Farneback optical flow, and React 19 + TypeScript (Stoken crypto-wallet dark aesthetic). Phases 0 through 4 are complete and committed to GitHub (origin/main).

Your Immediate Mission:
1. Review `AGENT_HANDOFF.md` to understand all completed features (Phases 0–4) and architectural patterns.
2. Begin work on Phase 5: Build the Metrics & Latency Benchmarking Dashboard and the Evaluation Harness (`backend/tests/eval_harness.py`).
3. Follow all design guidelines (Stoken aesthetic: Lavender #9D8DF7, Sage #6E9A76, Cream #F2F2EE, Charcoal #1B1B1F, glassmorphism) and commit your progress to Git.

Let's get started!
```
