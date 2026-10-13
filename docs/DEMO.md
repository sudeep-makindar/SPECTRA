# SPECTRA — Final Review Demo Runbook

## 0. Before the judges arrive (10 min)

```bash
# Terminal 1 — backend (models load in ~20 s; watch for "Startup complete")
cd backend && .venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000

# Terminal 2 — frontend (HTTPS so phones can use camera + mic)
./scripts/make_https.sh --force      # re-run whenever you change Wi-Fi
cd frontend && npm run dev
```

1. Put your Claude key in `.env` at the project root: `ANTHROPIC_API_KEY=sk-ant-...`, then restart the backend.
   **System** page → "AI co-pilot" tile should show `claude-opus-5-5`, not "Offline templates".
2. Open `https://localhost:5173` on the Mac (accept the certificate warning once).
3. **Incidents → Reset** to clear rehearsal incidents.
4. **Connect device → This Mac → Camera** (zone: Main Gate) and **→ Microphone** (zone: Main Gate).
   The first time, macOS asks for camera/mic permission for the terminal. Allow it, then re-add.
5. **Connect device → Phone** (zone: Stage Front) → scan the QR → accept the cert warning → **Start streaming**.
   Repeat for phone 2 (zone: Exit Corridor).
6. **Connect device → Video / RTSP** → path to your recorded crowd video (zone: Stage Front or Exit Corridor).
7. **Zones → Main Gate**: set **Area m²** to the floor area your Mac camera actually sees (~3–4 m² at a desk).
   This turns headcount into people/m², so 3–4 people in frame reads as LoS C/D.
8. Keep the **System** page open in a second tab for the latency/eval segment.

## 1. The 5-minute story

| Time | Show | Say |
|---|---|---|
| 0:00 | Command Center | "Crowd crushes in India (Hathras 2024, Tirupati and Bengaluru 2025, Kumbh) aren't detected late because there were no cameras. Control rooms have a hundred feeds and no way to know which one matters. SPECTRA watches every camera, microphone and phone at once and tells the operator **where to look and why**." |
| 0:40 | Live Ops: your face on the Mac camera, phones | "Everything runs on this laptop: YOLO tracking, optical flow, an audio transformer, Whisper. Phones become sensors by scanning a QR code. No video leaves the building." |
| 1:10 | Gather 3–4 people in front of the Mac camera | Watch Main Gate's people/m² and Fruin Level of Service climb live. "Fruin LoS is what crowd-safety engineers actually use. At F, over 5 people/m², people can no longer move on their own." |
| 1:40 | **Scenario Director → Concert Peak (False-Alarm Test)** on Stage Front | "Here's why other systems fail. Loud singing and shouting: an audio-only detector would page security every song. SPECTRA caps any single sensor, so this stays ELEVATED. **No false alarm.**" |
| 2:20 | **Panic Scatter & Distress** on Main Gate (or have someone shout "help!" / "bachao!" into the Mac mic while people move quickly) | Banner goes CRITICAL, tone plays, phone on that zone turns red and vibrates. "Motion surged 4× above this camera's own baseline, the audio model heard screaming, and Whisper caught 'bachao'. Three independent sensors agree, so risk compounds." |
| 3:00 | Click **Open incident** | Evidence clip with 8 s before and 6 s after the trigger, heads anonymised. The **Claude briefing**: what's happening, a confidence level, a false-alarm check, an action checklist from the zone's SOPs, and the PA announcement in **English and Hindi**. "Claude only sees the numbers, never the video." |
| 3:40 | Press **A** (acknowledge), **E** (escalate) | Audit log records every operator action. **⎙ Report / PDF** gives a printable incident report. |
| 4:00 | **System** page | Live p95 latency (~35 ms capture→alert for YOLO). Then the benchmark: "Across 9 scenarios × 40 randomized trials, any-sensor OR catches everything but raises false alarms 80% of the time. SPECTRA keeps 100% detection and cuts false alarms to 13% under noise and sensor dropout." |
| 4:30 | **Sensor Failure / Blind Spot** | "A dead camera must never look like a calm zone." Zone goes BLIND, dashed outline, event logged. |
| 4:45 | **Incidents → ✦ Shift report** | Claude writes the handover for the next shift lead. Close on "decision support, not autopilot". |

## 2. Likely judge questions

- **"Isn't the benchmark synthetic?"** Yes, and the page says so. It tests the fusion logic with randomized sensor evidence through the exact production code. Thresholds were tuned on the standard suite, and the headline numbers come from a held-out stress suite. Perception latency is measured on real video (`make eval`).
- **"Why not just use the LLM for detection?"** Latency, privacy and cost. Detection is deterministic and runs on-device in milliseconds. Claude only writes the briefing, from metadata, after the alarm.
- **"What about Diwali crackers / stage pyro?"** Fireworks, firecrackers and drums suppress the gunshot hard-trigger when the audio model rates them more likely.
- **"Privacy / DPDP Act?"** All inference is on the edge. Stored clips have heads pixelated using the person detector. The LLM receives no images or audio.
- **"Scale?"** Each camera has one inference in flight with latest-frame-wins backpressure. Load shows up as skipped frames, never as growing latency. The System page shows this live.

## 3. If something breaks

| Problem | Fix |
|---|---|
| Phone says camera blocked | It opened `http://`. Use the `https://` QR link and accept the certificate warning. |
| Phone can't reach the Mac | Same Wi-Fi? Venue Wi-Fi often isolates clients. Use your phone hotspot for the Mac and the phones, then run `./scripts/make_https.sh --force` and restart Vite. |
| Mac camera tile says "No signal" | macOS camera permission for the terminal app: System Settings → Privacy → Camera. |
| Co-pilot shows "offline templates" | `ANTHROPIC_API_KEY` missing in `.env`, or no internet. Templates still work, so the demo still runs. |
| Everything is slow | Close other apps. Remove extra camera sources. AI fps per camera is on the System page. |
