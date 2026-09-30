"""
Data schemas for the Perception layer.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class RiskSample:
    """Output of a perception worker for a specific frame/chunk.
    
    This is passed to the Fusion Engine (Phase 3).
    """
    source_id: str
    modality: str  # "vision" | "motion" | "audio"
    
    # 0.0 to 1.0 score
    score: float 
    
    # Epoch time the original frame/chunk was captured
    ts_capture: float 
    
    # Epoch time this sample was produced
    ts_processed: float = field(default_factory=time.time)
    
    # Explanation / raw data for the evidence clip
    metadata: dict = field(default_factory=dict)
