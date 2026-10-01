"""
API Endpoints for Incidents and Evidence Replay.
"""

import os
from typing import List, Dict
from pathlib import Path
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.core.config import INCIDENTS_DIR

router = APIRouter(prefix="/api/incidents", tags=["incidents"])

class IncidentInfo(BaseModel):
    id: str
    zone_id: str
    source_id: str
    timestamp: float
    filename: str
    size_mb: float
    url: str

@router.get("/", response_model=List[IncidentInfo])
def list_incidents():
    """List all recorded incidents."""
    incidents = []
    if not INCIDENTS_DIR.exists():
        return incidents
        
    for file_path in INCIDENTS_DIR.glob("*.mp4"):
        try:
            # Expected filename format: zoneID_sourceID_YYYYMMDD_HHMMSS.mp4
            parts = file_path.stem.split("_")
            if len(parts) >= 4:
                zone_id = parts[0]
                source_id = parts[1]
                
                import datetime
                date_str = f"{parts[2]}_{parts[3]}"
                dt = datetime.datetime.strptime(date_str, "%Y%m%d_%H%M%S")
                ts = dt.timestamp()
                
                size_mb = os.path.getsize(file_path) / (1024 * 1024)
                
                incidents.append(IncidentInfo(
                    id=file_path.stem,
                    zone_id=zone_id,
                    source_id=source_id,
                    timestamp=ts,
                    filename=file_path.name,
                    size_mb=round(size_mb, 2),
                    url=f"/api/incidents/{file_path.name}"
                ))
        except Exception as e:
            continue
            
    # Sort by newest first
    incidents.sort(key=lambda x: x.timestamp, reverse=True)
    return incidents

@router.get("/{filename}")
def get_incident_video(filename: str):
    """Serve the mp4 video file for an incident."""
    file_path = INCIDENTS_DIR / filename
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="Incident video not found")
        
    return FileResponse(
        path=file_path,
        media_type="video/mp4",
        filename=filename
    )
