"""
Fusion Engine — the brain of Spectra.

Perception workers push RiskSamples (per source, per modality). The engine
routes each sample to its source's zone, then a 2 Hz tick per zone:

1. aggregates fresh per-source evidence (headcount → people/m² → Fruin LoS)
2. merges any active simulation scenario (clearly flagged)
3. runs the gated FusionCore (shared with the eval harness)
4. writes a human-readable "why", a trend forecast, and the event log
5. opens / escalates / closes incidents, triggering evidence clips and the
   AI co-pilot briefing
"""

from __future__ import annotations

import asyncio
import logging
import math
import time
import uuid
from collections import deque

from app.core.config import load_config
from app.core.metrics import MetricsCollector
from app.fusion.core import FusionCore, FusionParams, level_rank
from app.fusion.schema import ZoneState, SystemState
from app.perception.schema import RiskSample
from app.zones.manager import ZoneManager, fruin_level

logger = logging.getLogger("spectra.fusion.engine")

TICK_S = 0.5
FRESH_S = 3.0          # per-source evidence older than this is ignored
GRID_ROWS, GRID_COLS = 6, 8


class FusionEngine:
    _instance = None

    def __init__(self):
        self._config = load_config()
        self._params = FusionParams.from_config(self._config.fusion)
        self._is_running = False
        self._zones: dict[str, ZoneState] = {}
        self._cores: dict[str, FusionCore] = {}
        # Latest evidence per source, per modality
        self._vision: dict[str, dict] = {}
        self._motion: dict[str, dict] = {}
        self._audio: dict[str, dict] = {}
        self._hard_until: dict[str, float] = {}
        self._was_blind: dict[str, bool] = {}
        self._events: deque[dict] = deque(maxlen=200)
        self._queue: asyncio.Queue[RiskSample] = asyncio.Queue(maxsize=2000)
        self._tasks: list[asyncio.Task] = []
        self._sync_zones()

    @classmethod
    def instance(cls) -> "FusionEngine":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    # ── Lifecycle ──────────────────────────────────────────────────────

    async def start(self) -> None:
        if self._is_running:
            return
        self._is_running = True
        self._tasks = [asyncio.create_task(self._sample_loop()), asyncio.create_task(self._tick_loop())]
        logger.info("Fusion Engine started (%d zones)", len(self._zones))

    async def stop(self) -> None:
        self._is_running = False
        for t in self._tasks:
            t.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        logger.info("Fusion Engine stopped")

    async def on_sample_received(self, sample: RiskSample) -> None:
        if not self._is_running:
            return
        try:
            self._queue.put_nowait(sample)
        except asyncio.QueueFull:
            logger.warning("Fusion queue full! Dropping sample %s", sample.source_id)

    # ── Zones ──────────────────────────────────────────────────────────

    def _sync_zones(self) -> None:
        cfgs = {z.id: z for z in ZoneManager.instance().all()}
        for zid, cfg in cfgs.items():
            if zid not in self._zones:
                self._zones[zid] = ZoneState(zone_id=zid, name=cfg.name)
                self._cores[zid] = FusionCore(params=self._params)
            self._zones[zid].name = cfg.name
        for zid in list(self._zones):
            if zid not in cfgs:
                del self._zones[zid]
                del self._cores[zid]

    def zone_of_source(self, source_id: str) -> str:
        from app.ingest.registry import SourceRegistry
        entry = SourceRegistry.instance().get(source_id)
        zid = entry.zone_id if entry else None
        if not zid or zid not in self._zones:
            zid = ZoneManager.instance().default_zone_id()
        return zid

    def get_zone(self, zone_id: str) -> ZoneState | None:
        return self._zones.get(zone_id)

    def acknowledge(self, zone_id: str) -> None:
        z = self._zones.get(zone_id)
        if z:
            z.acknowledged = True
            self._event(z, "acknowledged", "info", f"{z.name}: alert acknowledged by operator")

    # ── Samples ────────────────────────────────────────────────────────

    async def _sample_loop(self) -> None:
        metrics = MetricsCollector.instance()
        while self._is_running:
            try:
                sample = await self._queue.get()
                self._apply_sample(sample)
                metrics.record_latency(sample.source_id, "e2e", (time.time() - sample.ts_capture) * 1000)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("Error applying sample: %s", e, exc_info=True)

    def _apply_sample(self, s: RiskSample) -> None:
        rec = {"ts": time.time(), "score": s.score, **s.metadata}
        if s.modality == "vision":
            self._vision[s.source_id] = rec
        elif s.modality == "motion":
            self._motion[s.source_id] = rec
        elif s.modality == "audio":
            self._audio[s.source_id] = rec
            if s.metadata.get("hard_trigger"):
                self._hard_until[self.zone_of_source(s.source_id)] = time.time() + 4.0

    # ── Tick ───────────────────────────────────────────────────────────

    async def _tick_loop(self) -> None:
        while self._is_running:
            t0 = time.time()
            try:
                self._sync_zones()
                for zid in list(self._zones):
                    self._tick_zone(zid, t0)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("Fusion tick error: %s", e, exc_info=True)
            MetricsCollector.instance().record_latency("fusion", "fusion", (time.time() - t0) * 1000)
            await asyncio.sleep(max(0.05, TICK_S - (time.time() - t0)))

    def _tick_zone(self, zid: str, now: float) -> None:
        from app.ingest.registry import SourceRegistry
        from app.scenarios.director import ScenarioDirector

        z = self._zones[zid]
        cfg = ZoneManager.instance().get(zid)
        core = self._cores[zid]
        default_zid = ZoneManager.instance().default_zone_id()

        # Sources in this zone
        entries = [e for e in SourceRegistry.instance().all()
                   if (e.zone_id if e.zone_id in self._zones else default_zid) == zid]
        z.source_ids = [e.source_id for e in entries]
        z.sources_online = sum(1 for e in entries if e.status == "online")
        sids = set(z.source_ids)

        def fresh(store: dict) -> list[dict]:
            return [r for sid, r in store.items() if sid in sids and now - r["ts"] < FRESH_S]

        vis, mot, aud = fresh(self._vision), fresh(self._motion), fresh(self._audio)

        # ── Vision: headcount → physical density ──
        count = sum(int(r.get("count", 0)) for r in vis)
        fallen = sum(int(r.get("fallen_count", 0)) for r in vis)
        chaos = max((r.get("chaos_index", 0.0) for r in vis), default=0.0)
        velocity = max((r.get("avg_velocity", 0.0) for r in vis), default=0.0)
        grid = self._merge_grids([r.get("grid") for r in vis])
        directions = [r.get("direction_deg") for r in vis if r.get("direction_deg") is not None]

        sim = ScenarioDirector.instance().signals(zid)
        z.scenario = sim["scenario"] if sim else None
        if sim and sim.get("people") is not None:
            count = max(count, sim["people"])
            if not grid or not any(any(row) for row in grid):
                grid = self._synthetic_grid(sim["people"], now)
        if sim:
            chaos = max(chaos, sim.get("chaos", 0.0))
            fallen = max(fallen, sim.get("fallen", 0))

        area = cfg.area_m2 if cfg else 50.0
        capacity = cfg.capacity if cfg else 100
        density = count / area if area > 0 else 0.0
        los, los_desc = fruin_level(density)
        # Physical density dominates; capacity overrun is a secondary signal.
        v_score = max(min(density / 4.0, 1.0), min(count / max(capacity, 1), 1.0) * 0.9)
        if velocity > 3.0 and chaos > 0.5:
            v_score = max(v_score, min(1.0, chaos * min(1.0, velocity / 12.0)))
        if fallen > 0:
            v_score = max(v_score, 0.6)

        # ── Motion: max baseline-relative anomaly across cameras ──
        m_score = max((r["score"] for r in mot), default=0.0)
        ratio = max((r.get("ratio", 0.0) for r in mot), default=0.0)
        flow_dirs = [r.get("direction_deg") for r in mot if r.get("direction_deg") is not None]

        # ── Audio: strongest threat across microphones ──
        top_audio = max(aud, key=lambda r: r["score"], default=None)
        a_score = top_audio["score"] if top_audio else 0.0
        audio_label = top_audio.get("threat_label") if top_audio else None
        transcript = top_audio.get("detected_text", "") if top_audio else ""
        keyword = top_audio.get("keyword") if top_audio else None
        hard = now < self._hard_until.get(zid, 0)

        sim_flags = {"vision": False, "motion": False, "audio": False}
        if sim:
            for m, cur in (("vision", v_score), ("motion", m_score), ("audio", a_score)):
                if sim[m] > cur:
                    sim_flags[m] = True
            v_score, m_score = max(v_score, sim["vision"]), max(m_score, sim["motion"])
            if sim["audio"] > a_score:
                a_score = sim["audio"]
                audio_label = sim["audio_label"] or audio_label
                transcript = sim["transcript"] or transcript
                keyword = sim["keyword"] or keyword
            hard = hard or sim["hard_trigger"]

        blind = bool(entries) and z.sources_online == 0
        if sim and sim.get("blind"):
            blind = True
            v_score = m_score = a_score = 0.0
            count, density, grid = 0, 0.0, []
            los, los_desc = fruin_level(0.0)

        # Smooth per-modality evidence (audio decays slowly so short events persist)
        z.vision.score = 0.5 * v_score + 0.5 * z.vision.score
        z.motion.score = 0.6 * m_score + 0.4 * z.motion.score
        z.audio.score = max(a_score, z.audio.score * 0.85)
        for m, has in (("vision", vis or sim), ("motion", mot or sim), ("audio", aud or sim)):
            st = getattr(z, m)
            if has:
                st.last_updated = now
            st.simulated = sim_flags[m]

        z.people_count = count
        z.density_ppm2 = density
        z.los, z.los_desc = los, los_desc
        z.fallen_count = fallen
        z.chaos_index = chaos
        z.avg_velocity = velocity
        dirs = directions or flow_dirs
        z.flow_direction_deg = round(self._circular_mean(dirs), 1) if dirs else None
        z.occupancy_grid = grid
        z.audio_label = audio_label if z.audio.score > 0.15 else None
        z.transcript = transcript
        z.keyword = keyword
        z.hard_trigger = hard
        z.blind_spot = blind

        z.vision.context = f"{count} pax · {density:.1f}/m² · LoS {los}" + (f" · {fallen} DOWN" if fallen else "")
        z.motion.context = f"{ratio:.1f}× baseline" if ratio else ("turbulence" if m_score > 0.4 else "steady")
        z.audio.context = (f"{audio_label}" if audio_label else "ambient") + (f" · “{keyword}”" if keyword else "")

        # ── Fusion ──
        scores = {"vision": z.vision.score, "motion": z.motion.score, "audio": z.audio.score}
        res = core.step(now, scores, hard_trigger=hard)
        z.risk_score, z.raw_score = res.risk, res.raw
        z.alert_level = res.level
        z.contributions, z.active_modalities, z.corroborated = res.contributions, res.active, res.corroborated
        z.forecast = core.forecast()
        # A slow drift while calm extrapolates to "CRITICAL in 6 min", which reads
        # as a false alarm. Only forecast once risk is raised and the ETA is near.
        for key in ("eta_high_s", "eta_critical_s"):
            eta = z.forecast.get(key)
            if res.level == "normal" or (eta is not None and eta > 120):
                z.forecast[key] = None
        z.history.append([round(now, 1), round(res.risk, 3), round(scores["vision"], 3),
                          round(scores["motion"], 3), round(scores["audio"], 3)])
        z.reasons = self._explain(z, ratio)
        z.last_updated = now

        if blind and not self._was_blind.get(zid):
            self._event(z, "blind_spot", "warning", f"{z.name}: all feeds lost — zone is BLIND")
        elif not blind and self._was_blind.get(zid):
            self._event(z, "coverage_restored", "info", f"{z.name}: coverage restored")
        self._was_blind[zid] = blind

        if res.transitioned:
            self._on_transition(z, res.previous_level, res.level)
        if z.open_incident_id:
            self._update_incident(z)

    # ── Explainability ─────────────────────────────────────────────────

    def _explain(self, z: ZoneState, ratio: float) -> list[str]:
        """Human-readable reasons, strongest evidence first."""
        if z.blind_spot:
            return ["All sources offline — zone is blind; treat as unknown, not calm"]
        weighted: list[tuple[float, str]] = []
        if z.vision.score >= 0.3:
            weighted.append((z.vision.score, f"Density {z.density_ppm2:.1f} people/m² — Fruin LoS {z.los} ({z.los_desc})"))
        if z.fallen_count:
            weighted.append((0.95, f"{z.fallen_count} person(s) appear to be down"))
        if z.motion.score >= 0.3:
            surge = f"Sudden motion surge {ratio:.1f}× camera baseline" if ratio >= 1.5 else "Sudden crowd motion surge vs baseline"
            weighted.append((z.motion.score, surge))
            if z.chaos_index > 0.5:
                weighted.append((z.motion.score - 0.01, f"Crowd turbulence — heading variance {z.chaos_index:.2f}"))
        if z.hard_trigger:
            weighted.append((1.0, "Impulsive gunshot/explosion acoustic signature"))
        elif z.audio.score >= 0.3 and z.audio_label:
            weighted.append((z.audio.score, f"Acoustic threat: {z.audio_label} ({z.audio.score:.0%})"))
        if z.keyword and z.audio.score >= 0.3:
            weighted.append((min(1.0, z.audio.score + 0.15), f"Distress keyword “{z.keyword}” heard: “{z.transcript[:60]}”"))
        r = [text for _, text in sorted(weighted, key=lambda x: -x[0])]
        if z.corroborated:
            r.append("Cross-modal confirmation: " + " + ".join(z.active_modalities) + " agree")
        elif len(z.active_modalities) == 1:
            r.append(f"Single-modality signal ({z.active_modalities[0]}) — capped until corroborated")
        if z.forecast.get("eta_critical_s"):
            r.append(f"Trend: CRITICAL in ~{int(z.forecast['eta_critical_s'])} s at current rate")
        return r

    # ── Events & incidents ─────────────────────────────────────────────

    def _event(self, z: ZoneState, kind: str, severity: str, message: str, **extra) -> dict:
        ev = {"id": uuid.uuid4().hex[:10], "ts": time.time(), "zone_id": z.zone_id,
              "zone_name": z.name, "kind": kind, "severity": severity, "message": message,
              "simulated": bool(z.scenario), **extra}
        self._events.append(ev)
        return ev

    def events(self, limit: int = 60) -> list[dict]:
        return list(self._events)[-limit:]

    def log_event(self, zone_id: str, kind: str, severity: str, message: str, **extra) -> None:
        z = self._zones.get(zone_id)
        if z:
            self._event(z, kind, severity, message, **extra)

    def _snapshot(self, z: ZoneState) -> dict:
        d = z.to_dict(include_history=False)
        d.pop("occupancy_grid", None)
        return d

    def _on_transition(self, z: ZoneState, prev: str, new: str) -> None:
        from app.incidents.store import IncidentStore
        up = level_rank(new) > level_rank(prev)
        sev = {"normal": "info", "elevated": "notice", "high": "warning", "critical": "critical"}[new]
        why = z.reasons[0] if z.reasons else ""
        self._event(z, "level_change", sev,
                    f"{z.name}: {prev.upper()} → {new.upper()}" + (f" — {why}" if why and up else ""),
                    level=new, previous=prev, risk=round(z.risk_score, 3))
        logger.info("Zone %s: %s → %s (risk %.2f)", z.zone_id, prev, new, z.risk_score)
        if up:
            z.acknowledged = False

        store = IncidentStore.instance()
        if up and level_rank(new) >= level_rank("high"):
            if not z.open_incident_id:
                inc = store.open(z.zone_id, z.name, new, z.risk_score, self._snapshot(z),
                                 list(z.history)[-120:], z.scenario)
                z.open_incident_id = inc["id"]
                self._event(z, "incident_opened", sev, f"Incident opened in {z.name}", incident_id=inc["id"])
                self._spawn_followups(inc["id"], z.zone_id, record=True)
            else:
                inc = store.get(z.open_incident_id)
                if inc and level_rank(new) > level_rank(inc["peak_level"]):
                    inc["peak_level"] = new
                    inc["peak_snapshot"] = self._snapshot(z)
                    store.add_log(inc["id"], "escalated_auto", "system", f"Escalated to {new.upper()}")
                    self._spawn_followups(inc["id"], z.zone_id, record=False)
        elif new == "normal" and z.open_incident_id:
            inc = store.get(z.open_incident_id)
            if inc:
                inc["ended_at"] = time.time()
                store.add_log(inc["id"], "closed", "system", "Zone returned to NORMAL")
                from app.notify.telegram import TelegramNotifier
                asyncio.get_running_loop().create_task(TelegramNotifier.instance().on_incident_closed(inc["id"]))
                self._event(z, "incident_closed", "info", f"{z.name} back to NORMAL — incident closed",
                            incident_id=inc["id"])
            z.open_incident_id = None

    def _update_incident(self, z: ZoneState) -> None:
        from app.incidents.store import IncidentStore
        inc = IncidentStore.instance().get(z.open_incident_id)
        if not inc:
            z.open_incident_id = None
            return
        if z.history:
            inc["timeline"].append(list(z.history[-1]))
            inc["timeline"] = inc["timeline"][-600:]
        if z.risk_score > inc["peak_risk"]:
            inc["peak_risk"] = round(z.risk_score, 3)
            inc["peak_snapshot"] = self._snapshot(z)
        # Persist roughly every 5 s
        if time.time() - inc.get("updated_at", 0) > 5:
            IncidentStore.instance().save(inc)

    def _spawn_followups(self, inc_id: str, zone_id: str, record: bool) -> None:
        from app.evidence.manager import EvidenceManager
        from app.ai.copilot import Copilot
        from app.notify.telegram import TelegramNotifier
        if record:
            EvidenceManager.instance().trigger_incident(zone_id, inc_id)
        loop = asyncio.get_running_loop()
        loop.create_task(Copilot.instance().brief_incident(inc_id))
        loop.create_task(TelegramNotifier.instance().on_incident(inc_id, first=record))

    # ── Helpers ────────────────────────────────────────────────────────

    @staticmethod
    def _circular_mean(degs: list[float]) -> float:
        s = sum(math.sin(math.radians(d)) for d in degs)
        c = sum(math.cos(math.radians(d)) for d in degs)
        return math.degrees(math.atan2(s, c)) % 360

    @staticmethod
    def _merge_grids(grids: list) -> list[list[float]]:
        grids = [g for g in grids if g]
        if not grids:
            return []
        rows, cols = len(grids[0]), len(grids[0][0])
        same = [g for g in grids if len(g) == rows]
        return [[round(max(g[r][c] for g in same), 3) for c in range(cols)] for r in range(rows)]

    @staticmethod
    def _synthetic_grid(people: int, now: float) -> list[list[float]]:
        """Plausible heat blob for simulated crowds (drifts slowly)."""
        cx = GRID_COLS / 2 + 1.5 * math.sin(now / 7)
        cy = GRID_ROWS / 2 + 1.0 * math.cos(now / 9)
        spread = 1.2 + people / 12
        peak = min(1.0, people / 20)
        return [[round(peak * math.exp(-((c - cx) ** 2 + (r - cy) ** 2) / (2 * spread ** 2)), 3)
                 for c in range(GRID_COLS)] for r in range(GRID_ROWS)]

    def get_system_state(self, active_sources: int, total_sources: int) -> SystemState:
        zones = {zid: z.to_dict() for zid, z in self._zones.items()}
        return SystemState(
            active_sources=active_sources,
            total_sources=total_sources,
            active_zones=len(self._zones),
            highest_risk=max((z.risk_score for z in self._zones.values()), default=0.0),
            total_people=sum(z.people_count for z in self._zones.values()),
            zones=zones,
        )
