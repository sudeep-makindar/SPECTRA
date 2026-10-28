# SPECTRA — Final Review Demo Runbook

**Setup:** the HP Victus runs SPECTRA. The Mac, the Victus and two Android phones are the
4 cameras + 4 microphones. The Mac shows the dashboard on the projector. The Mac and the
Victus are the speakers.

| Device | Camera + mic via | Zone | Speaker |
|---|---|---|---|
| HP Victus | its own webcam + mic (**Add device → SPECTRA computer's webcam → Camera and mic**) | Gate | yes, set to Gate |
| Mac | `tools/Start SPECTRA camera.command` (**Add device → Another laptop**) | Stage | yes, set to Every zone |
| Phone 1 | IP Webcam app (**Add device → Android phone**) | Gate | no |
| Phone 2 | IP Webcam app (**Add device → Android phone**) | Stage | no |

## The night before

1. On the Victus: `git pull`, then run **Setup SPECTRA.bat** again so new packages and models are in place.
2. **Start SPECTRA.bat**, then `backend\.venv\Scripts\python tools\loadtest.py`. Every row should say *keeps up*.
3. Put your free Groq key in `.env` (`GROQ_API_KEY=gsk_…`). The AI summary and **Translate with AI** need it; everything else works without it.
4. Telegram: `TELEGRAM_BOT_TOKEN` is in `.env`. Add the bot to your team's group, send a message there, then **Devices → Alerts on Telegram → Find my group** → tick it → **Send a test message**. Telegram needs internet; some college Wi-Fi blocks it, so check it at the venue too (a phone hotspot works).
5. Charge everything. The phones stream for hours on a charger.
6. Rehearse the gunshot: play a gunshot sound effect from a third phone near one of the mics. A balloon pop works too. Check the **Sound** panel on that camera's focus page shows "Gunshot, gunfire" or "Bang".

## At the venue (15 minutes)

1. Put all four devices on **one Wi-Fi network**. If the venue Wi-Fi blocks devices from seeing each other, use a phone hotspot for everything.
2. Victus: **Start SPECTRA.bat**. Note the address it prints (e.g. `192.168.1.30`). Allow Python and Node.js on private networks if Windows asks.
3. Phones: open IP Webcam and tap **Start server**. Note each phone's address.
4. Mac: double-click `tools/Start SPECTRA camera.command`. Open `http://<victus-ip>:5173` in the browser and put it on the projector.
5. **Map → Edit layout**: create the zones **Gate** and **Stage**, place them on the map.
6. **Devices → Add device** for each of the four devices, in the zones above. Each one shows its live picture before you leave the dialog.
7. **Devices → Zones**: set each zone's floor area to what its cameras actually see (about 4–6 m² at a table). This is what turns 4–5 friends in frame into "Crowded".
8. Speaker button (top bar) on the Mac: **Every zone**. On the Victus: **Gate**. Click once on each page so the browser allows sound. Press **Test** to hear it.
9. **Alerts → Clear history** to remove rehearsal alerts.

## The 5-minute story

| Time | Do | Say |
|---|---|---|
| 0:00 | **Surveillance**: four live tiles | "India's crowd disasters happened in places full of cameras. Nobody can watch a hundred feeds. SPECTRA watches and listens to all of them, and every one of these is just a phone or a laptop." |
| 0:40 | Click the Mac's tile → **Camera focus** | "Here's every model working live: YOLO finds each person with a confidence score, optical flow compares movement with this camera's normal, and the audio transformer and Whisper listen. All on one laptop GPU; nothing goes to the cloud." |
| 1:30 | Friends crowd in front of the Gate phone | The Crowd meter climbs; Gate turns **Watch**, then **Needs attention**. "Packed crowding alone is serious, so it reaches Needs attention, but no single sense can ever say Act now." |
| 2:00 | A friend shouts "Help! Bachao!" into the same phone | Gate hits **Act now**, the chime plays, the tile glows red. Point at the fusion panel: "Two senses agree, so the risk compounds: here's the actual arithmetic." |
| 2:40 | **What to do** on the banner | The alert: clip with faces blurred, AI summary, false-alarm check, to-do list. "The AI only ever sees numbers, never the video." |
| 3:20 | **Announce this** → tick हिंदी and தமிழ் → **Play** | The Victus and the Mac read it aloud in three languages. Hold up a phone: the Telegram group already has the alert, the AI summary and a snapshot. |
| 3:50 | Play the gunshot sound near the Stage mic | Stage jumps to **Needs attention** instantly; people scattering makes it **Act now**. |
| 4:20 | **Run a demo → Loud concert, but safe** | Sound goes loud, status stays **Watch**. "A sound-only system would have called security. SPECTRA doesn't." |
| 4:45 | **Dashboard**, then **Alerts → Report** | Heatmap and timeline of everything that just happened, then the one-page report anyone can be sent. "Decision support, not autopilot." |

## Likely questions

- **"Is the benchmark real footage?"** No, and we say so: it replays simulated sensor readings through the exact production fusion code, to test the decision logic. Detection accuracy comes from the pretrained models.
- **"Why not let the LLM decide?"** Latency, privacy and cost. Detection is deterministic and runs on the local GPU in milliseconds; the LLM only writes the summary afterwards, from numbers.
- **"Diwali crackers?"** A gunshot that the sound model rates as more like fireworks, crackers or drums doesn't trigger.
- **"Privacy / DPDP Act?"** All analysis is on the local network, clips have faces blurred, the LLM gets no images or audio.
- **"Scale?"** Each camera keeps only its newest frame, so load shows up as fewer analysed frames, never as growing delay. `tools/loadtest.py` measures it.

## If something breaks

| Problem | Fix |
|---|---|
| A device won't connect | Open its address in the Victus browser (`http://<phone>:8080/`, `http://<mac>:8081/`). If that fails, the devices can't see each other: use a phone hotspot. |
| A tile shows "Waiting for the device" | IP Webcam stopped (tap **Start server** again) or the camera script window was closed. |
| No sound on a speaker | Click the page once, check the volume, press **Test** in the speaker dialog. On Windows, use Microsoft Edge for the Hindi and Tamil voices. |
| AI summary says "offline summary" | No internet or no Groq key. The ready-made announcements still work in all three languages. |
| Everything is slow | Close other apps on the Victus. In `backend/config/app.yaml` set `video.yolo_model: yolo26n.pt` and restart. |
