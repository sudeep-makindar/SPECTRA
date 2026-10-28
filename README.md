# SPECTRA

**Crowd-safety monitoring that watches and listens to every camera at once, and only raises the alarm when its senses agree.**

SPECTRA turns ordinary laptops and phones into a CCTV network. One computer with a GPU runs the AI: it counts people and measures how tightly they're packed, notices sudden rushes, and listens for screams, gunshots and calls for help ("help", "bachao", "madad"). When the risk is real it opens an alert with a video clip, an AI-written summary and to-do list, and plays a calm announcement in English, Hindi and Tamil on the speakers in that zone.

> SPECTRA is a decision-support prototype for human operators, not a certified life-safety system.

## Why

India's recent crowd disasters (Hathras 2024; Tirupati, the Kumbh and Bengaluru in 2025) all happened in places full of cameras. What was missing was something that watches every feed at once, recognises rising density and distress early, and gets an operator's attention without crying wolf.

Single-sensor systems fail in opposite directions: sound-only detectors page security for every song, camera-only detectors can't tell a happy dense crowd from a dangerous one. SPECTRA's core idea is **gated fusion**: no single sense can reach "Act now", and independent senses that agree compound into a confident alarm.

## What you see

| Page | What it shows |
|---|---|
| **Surveillance** | A CCTV wall of every camera with the AI overlay. Tiles glow amber → red as their zone heats up. |
| **Camera focus** | One camera and every model working on it: each detected person and their confidence, movement vs that camera's normal, a live sound spectrogram, the top sound types, what Whisper heard, and the fusion arithmetic that gives the zone's risk. |
| **Map** | Zones as circles on a real street map, coloured by risk, with a pin per device. |
| **Dashboard** | Totals, a risk heatmap per zone over the last two minutes, a timeline of what happened, all alerts. |
| **Alerts** | Clip (8 s before → 6 s after, faces blurred), AI summary, false-alarm check, to-do list, announcement, and a one-click **report**: a single HTML file with the timeline, clip frames, summary and every action taken (print it for a PDF). |
| **Devices** | Add cameras and mics in four steps, with a live test before saving. |

Plus **Announce** (EN / HI / TA, offline-ready messages and AI translation), **speaker mode** for any dashboard, **Telegram alerts** to a group chat (the reason at once, then the AI summary with a snapshot, then the report once it's calm), and **Run a demo**: scripted situations (gate surge, panic with "bachao", loud-but-safe concert, gunshot, cameras going dark) layered on the live sensors and labelled "Demo".

## How it works

```
 Devices on the same Wi-Fi, each streaming like a CCTV camera
 ─────────────────────────────────────────────────────────────
 Laptops        tools/spectra_camera.py   http://<ip>:8081/stream  + /audio
 Android phones IP Webcam app             http://<ip>:8080/video   + /audio.wav
 Any phone      SPECTRA page (QR code)    pushes over WebSocket, can be a speaker
 GPU computer   its own webcam + mic
        │
        ▼  SPECTRA server (one computer, NVIDIA GPU preferred)
 ① Ingest      one reader per device, newest frame only → no growing delay
 ② Perception  YOLO26s + ByteTrack (people) · Farnebäck optical flow (movement)
               AST AudioSet classifier (sounds) · Whisper tiny (words, only on speech)
 ③ Fusion      per zone, every 0.5 s: caps per sense, agreement compounds,
               smoothing, Calm → Watch → Needs attention → Act now, trend forecast
 ④ Alerts      clip + AI summary (LLM sees numbers only, never video or audio)
 ⑤ Dashboard   live over WebSocket; speakers read announcements aloud
```

Fusion rule (`backend/app/fusion/core.py`, shared with the benchmark): each sense is capped (crowding 0.72, movement 0.50, sound 0.50). With one sense worried, risk is the highest capped value. With two or more, risk = 1.2 × (1 − Π(1 − capped)).

## Results

The benchmark (`make eval`) replays 9 situations × 60 randomised runs through the production fusion code, with doubled sensor noise and 15% sensor dropout:

| Approach | Catches real emergencies | False alarms |
|---|---|---|
| Sound only | 75% | 40% |
| Camera head count only | 75% | 26% |
| Movement only | 75% | 20% |
| Any one sensor can alarm | 100% | 80% |
| **SPECTRA (senses must agree)** | **100%** | **10%** |

These are simulated sensor readings, not recorded footage: they test the decision logic, not detection accuracy.

## Setup

### Windows with an NVIDIA GPU (recommended server)

1. Install [Git](https://git-scm.com/download/win), [Python 3.12](https://www.python.org/downloads/) (tick **Add python.exe to PATH**), [Node.js LTS](https://nodejs.org/) and the latest NVIDIA driver.
2. `git clone https://github.com/sudeep-makindar/SPECTRA.git`
3. Copy your `.env` into the SPECTRA folder: `GROQ_API_KEY` (free at console.groq.com/keys) for the AI assistant, `TELEGRAM_BOT_TOKEN` (from @BotFather) for Telegram alerts. Never commit it.
4. Double-click **`Setup SPECTRA.bat`** once (about 3 GB; do it on good Wi-Fi).
5. Double-click **`Start SPECTRA.bat`**. It prints the dashboard address for other devices.

### macOS / Linux

```bash
make setup                 # Python deps + npm install
cp .env.example .env       # add GROQ_API_KEY for the AI assistant
make dev-backend           # :8000
make dev-frontend          # :5173
```

### Connect cameras and microphones

See **[tools/README.md](tools/README.md)**: IP Webcam on Android phones, the camera script on other laptops, the QR page for any phone.

### Check the computer keeps up

With SPECTRA running: `python tools/loadtest.py` (default 4 cameras + 4 mics). On an Apple Silicon Mac, 4 + 4 falls behind (about 2 of 5 frames a second analysed); on an NVIDIA laptop it should keep up. If not, set `video.yolo_model: yolo26n.pt` in `backend/config/app.yaml`.

```bash
make test                  # backend tests
make eval                  # fusion benchmark → data/eval/report.{json,md}
```

## Privacy

- All AI runs on the SPECTRA computer. Video and audio never leave the local network.
- The LLM receives numbers and short labels only; without internet, summaries use built-in templates and the ready-made announcements still work in all three languages.
- Saved clips have every detected person's face blurred.
- Simulated signals are labelled "Demo" everywhere.

## Limitations

- The models are general-purpose (COCO, AudioSet), not trained on crowd disasters; the benchmark uses simulated sensor readings.
- Crowding is estimated from a head count and the floor area entered per zone, assuming cameras don't overlap.
- The "person on the ground" check is a box-shape heuristic and is noisy.
- The trend forecast extrapolates the current trend; it isn't a trained predictor.

## Licences

Ultralytics YOLO is AGPL-3.0; deployments must comply or obtain a commercial licence. AST is BSD-licensed; Whisper is MIT.
