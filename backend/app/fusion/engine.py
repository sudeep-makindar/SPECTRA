"""
Fusion Engine — The brain of Spectra.

Takes raw RiskSamples from the AI models, smooths them, applies cross-modal logic,
and manages the state machine (Normal -> Elevated -> High -> Critical) per Zone.
"""

from __future__ import annotations

import asyncio
import logging
import time

from app.core.config import load_config
from app.perception.schema import RiskSample
from app.fusion.schema import ZoneState, SystemState

logger = logging.getLogger("spectra.fusion.engine")


class FusionEngine:
    _instance = None

    def __init__(self):
        self._config = load_config()
        self._is_running = False
        
        # In memory state of all zones
        self._zones: dict[str, ZoneState] = {}
        
        # We process samples via a queue to ensure thread safety 
        # (even though asyncio is single threaded, it organizes flow)
        self._queue: asyncio.Queue[RiskSample] = asyncio.Queue(maxsize=1000)
        self._task: asyncio.Task | None = None
        
        # Create a default "Global Zone" for sources that aren't assigned to one
        self.get_or_create_zone("default", "Global Zone")

    @classmethod
    def instance(cls) -> "FusionEngine":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def get_or_create_zone(self, zone_id: str, name: str) -> ZoneState:
        if zone_id not in self._zones:
            self._zones[zone_id] = ZoneState(zone_id=zone_id, name=name)
        return self._zones[zone_id]

    async def start(self) -> None:
        if self._is_running:
            return
        
        self._is_running = True
        self._task = asyncio.create_task(self._run_loop())
        logger.info("Fusion Engine started")

    async def stop(self) -> None:
        self._is_running = False
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Fusion Engine stopped")

    async def on_sample_received(self, sample: RiskSample) -> None:
        """Callback for PerceptionManager to push new samples."""
        if not self._is_running:
            return
            
        try:
            # Non-blocking put
            self._queue.put_nowait(sample)
        except asyncio.QueueFull:
            logger.warning("Fusion queue full! Dropping sample %s", sample.source_id)

    def get_system_state(self, active_sources: int, total_sources: int) -> SystemState:
        """Called by the WebSocket handler at 2Hz to get the current global state."""
        highest_risk = 0.0
        zones_dict = {}
        
        for z_id, state in self._zones.items():
            if state.risk_score > highest_risk:
                highest_risk = state.risk_score
            zones_dict[z_id] = state.to_dict()
            
        return SystemState(
            active_sources=active_sources,
            total_sources=total_sources,
            active_zones=len(self._zones),
            highest_risk=highest_risk,
            zones=zones_dict
        )

    async def _run_loop(self) -> None:
        """Main fusion processing loop."""
        while self._is_running:
            try:
                sample = await self._queue.get()
                self._process_sample(sample)
                self._queue.task_done()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("Error processing sample in fusion engine: %s", e, exc_info=True)

    def _process_sample(self, sample: RiskSample) -> None:
        # In a real system, we'd lookup which zone this source_id belongs to.
        # For now, put everything in the default Global Zone.
        zone = self._zones.get("default")
        if not zone:
            return
            
        now = time.time()
        c = self._config.fusion
        
        # 1. Update Modality State with EMA Smoothing
        if sample.modality == "vision":
            # smooth the score so a single bad frame doesn't spike it
            zone.vision.score = (c.ema_alpha * sample.score) + ((1 - c.ema_alpha) * zone.vision.score)
            zone.vision.last_updated = now
            
            # Extract advanced UI context
            count = sample.metadata.get("count", 0)
            chaos = sample.metadata.get("chaos_index", 0.0)
            fallen = sample.metadata.get("fallen_count", 0)
            
            ctx = f"{count} pax"
            if fallen > 0:
                ctx += f" | {fallen} FALLEN"
            elif chaos > 0.6:
                ctx += " | CHAOS"
            zone.vision.context = ctx

        elif sample.modality == "motion":
            zone.motion.score = (c.ema_alpha * sample.score) + ((1 - c.ema_alpha) * zone.motion.score)
            zone.motion.last_updated = now
            zone.motion.context = f"Mag: {sample.metadata.get('magnitude', 0.0):.1f}"

        elif sample.modality == "audio":
            # Audio spikes are critical, less EMA smoothing, more instant reaction
            zone.audio.score = max(sample.score, zone.audio.score * 0.8) # decay slowly
            zone.audio.last_updated = now
            
            label = sample.metadata.get("threat_label")
            text = sample.metadata.get("detected_text", "")
            if text:
                zone.audio.context = f"[{text}]"
            elif label:
                zone.audio.context = label
            else:
                zone.audio.context = sample.metadata.get("top_class", "Normal")

        # 2. Re-calculate Zone Fusion Score
        # Zero out stale modalities
        if zone.vision.age > c.staleness_timeout_s:
            zone.vision.score = 0.0
        if zone.motion.age > c.staleness_timeout_s:
            zone.motion.score = 0.0
        if zone.audio.age > c.staleness_timeout_s:
            zone.audio.score = 0.0
            
        v_weighted = zone.vision.score * c.weight_density
        m_weighted = zone.motion.score * c.weight_motion
        a_weighted = zone.audio.score * c.weight_audio
        
        # How many modalities are reporting high risk? (> 0.5)
        active_modalities = 0
        if zone.vision.score > 0.5: active_modalities += 1
        if zone.motion.score > 0.5: active_modalities += 1
        if zone.audio.score > 0.5: active_modalities += 1
        
        base_score = v_weighted + m_weighted + a_weighted
        
        # Cross-modal amplification
        if active_modalities >= 2:
            fused_score = base_score * c.cross_modal_multiplier
        elif active_modalities == 1:
            fused_score = base_score * c.single_modal_dampen
        else:
            fused_score = base_score
            
        # Hard overrides (e.g., Gunshot detected -> Instant Critical)
        if zone.audio.score > c.gunshot_hard_trigger:
            fused_score = max(fused_score, 0.95)
            
        zone.risk_score = min(fused_score, 1.0)
        zone.last_updated = now
        
        # 3. State Machine Transitions (Hysteresis)
        self._evaluate_state_machine(zone, c)

    def _evaluate_state_machine(self, zone: ZoneState, c) -> None:
        """
        Transitions alert_level using up/down hysteresis to prevent flickering.
        e.g., Need 0.8 to enter Critical, but won't drop to High until it falls below 0.65.
        """
        current = zone.alert_level
        score = zone.risk_score
        
        if current == "normal":
            if score >= c.threshold_critical_up:
                zone.alert_level = "critical"
                self._trigger_incident(zone)
            elif score >= c.threshold_high_up:
                zone.alert_level = "high"
            elif score >= c.threshold_elevated_up:
                zone.alert_level = "elevated"
                
        elif current == "elevated":
            if score >= c.threshold_critical_up:
                zone.alert_level = "critical"
                self._trigger_incident(zone)
            elif score >= c.threshold_high_up:
                zone.alert_level = "high"
            elif score < c.threshold_elevated_down:
                zone.alert_level = "normal"
                
        elif current == "high":
            if score >= c.threshold_critical_up:
                zone.alert_level = "critical"
                self._trigger_incident(zone)
            elif score < c.threshold_high_down:
                zone.alert_level = "elevated" # cascades down naturally
                
        elif current == "critical":
            if score < c.threshold_critical_down:
                zone.alert_level = "high"

    def _trigger_incident(self, zone: ZoneState) -> None:
        """Called when a zone enters the Critical state."""
        from app.evidence.manager import EvidenceManager
        logger.warning("INCIDENT TRIGGERED IN ZONE: %s (Risk: %.2f)", zone.name, zone.risk_score)
        EvidenceManager.instance().trigger_incident(zone.zone_id)
