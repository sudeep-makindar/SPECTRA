"""
Incidents API — lifecycle, operator actions, AI briefings and evidence media.
"""

from __future__ import annotations

import asyncio
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.core.config import INCIDENTS_DIR
from app.incidents.store import IncidentStore

router = APIRouter(prefix="/api/incidents", tags=["incidents"])

ACTIONS = {"acknowledge": "acknowledged", "escalate": "escalated", "resolve": "resolved", "reopen": "open"}


class ActionRequest(BaseModel):
    action: str
    note: Optional[str] = ""


@router.get("")
@router.get("/")
def list_incidents(limit: int = 50) -> list[dict]:
    return IncidentStore.instance().summaries(limit)


@router.delete("")
def clear_incidents() -> dict:
    return {"deleted": IncidentStore.instance().delete_all()}


@router.get("/report/shift")
async def shift_report() -> dict:
    from app.ai.copilot import Copilot
    return await Copilot.instance().shift_report()


@router.get("/media/{filename}")
def get_media(filename: str):
    path = (INCIDENTS_DIR / filename).resolve()
    if INCIDENTS_DIR.resolve() not in path.parents or not path.is_file():
        raise HTTPException(status_code=404, detail="Media not found")
    media = "video/mp4" if path.suffix == ".mp4" else "image/jpeg"
    return FileResponse(path=path, media_type=media)


@router.get("/{incident_id}")
def get_incident(incident_id: str) -> dict:
    inc = IncidentStore.instance().get(incident_id)
    if not inc:
        raise HTTPException(status_code=404, detail="Incident not found")
    return inc


@router.post("/{incident_id}/action")
def incident_action(incident_id: str, req: ActionRequest) -> dict:
    from app.fusion.engine import FusionEngine
    status = ACTIONS.get(req.action)
    if not status:
        raise HTTPException(status_code=400, detail=f"Unknown action {req.action}")
    store = IncidentStore.instance()
    inc = store.add_log(incident_id, status, "operator", req.note or "")
    if not inc:
        raise HTTPException(status_code=404, detail="Incident not found")
    engine = FusionEngine.instance()
    if status in ("acknowledged", "escalated"):
        engine.acknowledge(inc["zone_id"])
    engine.log_event(inc["zone_id"], f"incident_{status}",
                     "warning" if status == "escalated" else "info",
                     f"{inc['zone_name']} incident {status} by operator" + (f" — {req.note}" if req.note else ""),
                     incident_id=incident_id)
    return inc


@router.post("/{incident_id}/rebrief")
async def rebrief(incident_id: str) -> dict:
    from app.ai.copilot import Copilot
    inc = IncidentStore.instance().get(incident_id)
    if not inc:
        raise HTTPException(status_code=404, detail="Incident not found")
    inc["brief_status"] = "pending"
    asyncio.create_task(Copilot.instance().brief_incident(incident_id))
    return {"status": "pending"}
