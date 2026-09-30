# Spectra — Roadmap

> Future work, tracked here instead of scattered as TODOs in code.

## Near-term (within current build)

- [ ] Zone "blind spot" indicator when all sources in a zone are offline or degraded
- [ ] One-line human "why" on every alert (e.g. "Scream + sudden crowd scatter, Gate 2")
- [ ] Merge alerts from different modalities into one incident instead of spamming
- [ ] Calibration mode: learn each camera's "normal" motion baseline in the first minute
- [ ] Keyboard-driven operator flow (A acknowledge, E escalate, J/K next incident)
- [ ] Command palette
- [ ] Subtle optional alert tone with mute toggle
- [ ] Confidence labels when running in audio-only or video-only degraded mode

## Medium-term (post v1)

- [ ] Incident replay with a scrubber synced to the score timeline and event markers
- [ ] 24-hour risk strip per zone
- [ ] Session recorder and deterministic replay with "what-if" threshold slider
- [ ] Shift handover summary and one-click incident report export (HTML/PDF)
- [ ] Face blur toggle on saved clips and dashboard (privacy)
- [ ] Browser-based node page with getUserMedia (/node)
- [ ] ONVIF/RTSP auto-discovery

## Long-term (Phase 7+)

- [ ] Fine-tune AST audio classifier on scream/gunshot datasets
- [ ] Lightweight panic classifier on optical flow features
- [ ] Multi-server deployment with source routing
- [ ] Integration with existing VMS (Video Management Systems)
- [ ] Mobile companion app for event safety leads
