"""REST API routes."""
from __future__ import annotations

import asyncio
import json
import uuid
from collections.abc import AsyncIterator
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from fastapi.responses import StreamingResponse

from .models import AnalysisJob
from .orchestrator import PipelineOrchestrator, orchestrator
from .auth import issue_auth_cookies
from .config import get_settings
from .services.session import SpaSessionManager, get_session_manager

router = APIRouter(prefix="/api", tags=["analysis"])


def get_orchestrator() -> PipelineOrchestrator:
    return orchestrator


@router.post("/analysis")
async def create_analysis(
    files: list[UploadFile] = File(...),
    webhook_url: Optional[str] = None,
    orchestrator: PipelineOrchestrator = Depends(get_orchestrator),
):
    if not files:
        raise HTTPException(status_code=400, detail="Nenhum arquivo enviado.")

    job = orchestrator.create_job(files, webhook_url)
    return _serialize_job(job)


@router.post("/session", tags=["auth"])
async def create_session(
    response: Response,
    session_manager: SpaSessionManager = Depends(get_session_manager),
) -> dict[str, int]:
    state = session_manager.get_session()
    issue_auth_cookies(response, state.access_token, state.refresh_token)
    settings = get_settings()
    response.headers['X-Session-Expires'] = str(int(state.expires_at))
    response.headers['X-Session-Cookie'] = settings.access_token_cookie_name
    return {
        "expiresAt": int(state.expires_at * 1000),
    }


@router.get("/analysis/{job_id}")
async def get_analysis(job_id: uuid.UUID, orchestrator: PipelineOrchestrator = Depends(get_orchestrator)):
    job = orchestrator.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Análise não encontrada")
    return _serialize_job(job)


@router.get("/analysis/{job_id}/progress")
async def get_progress(job_id: uuid.UUID, orchestrator: PipelineOrchestrator = Depends(get_orchestrator)):
    job = orchestrator.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Análise não encontrada")
    return {
        "jobId": str(job.id),
        "status": job.status.value,
        "agentStates": job.agent_states,
        "error": job.error_message,
    }


@router.get("/orchestrator/state/{job_id}")
async def stream_orchestrator_state(
    job_id: uuid.UUID,
    orchestrator: PipelineOrchestrator = Depends(get_orchestrator),
):
    async def event_stream() -> AsyncIterator[str]:
        last_payload: Optional[dict] = None
        try:
            while True:
                job = orchestrator.get_job(job_id)
                if not job:
                    yield "event: error\ndata: {\"detail\": \"Análise não encontrada\"}\n\n"
                    return

                payload = _serialize_job(job)
                if payload != last_payload:
                    data = json.dumps(payload, default=str)
                    yield f"event: state\ndata: {data}\n\n"
                    last_payload = payload

                status = payload.get("status")
                if status in {"completed", "failed"}:
                    return

                await asyncio.sleep(1)
        except asyncio.CancelledError:  # pragma: no cover - network disconnects
            return

    return StreamingResponse(event_stream(), media_type="text/event-stream")


def _serialize_job(job: AnalysisJob) -> dict:
    return {
        "jobId": str(job.id),
        "status": job.status.value,
        "agentStates": job.agent_states,
        "error": job.error_message,
        "result": job.result_payload,
        "createdAt": job.created_at.isoformat() if job.created_at else None,
        "updatedAt": job.updated_at.isoformat() if job.updated_at else None,
    }
