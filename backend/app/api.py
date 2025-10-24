"""REST API routes."""
from __future__ import annotations

import asyncio
import json
import uuid
from collections.abc import AsyncIterator
from copy import deepcopy
from typing import Annotated, Dict, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .auth import get_current_user, issue_auth_cookies
from .config import get_settings
from .crud import list_corrections, upsert_correction
from .database import get_session
from .models import AnalysisJob, ClassificationCorrection, OperationType
from .orchestrator import PipelineOrchestrator, orchestrator
from .services.session import SpaSessionManager, get_session_manager

router = APIRouter(prefix="/api", tags=["analysis"])


def get_orchestrator() -> PipelineOrchestrator:
    return orchestrator


UploadedFiles = Annotated[list[UploadFile], File(...)]
OrchestratorDep = Annotated[PipelineOrchestrator, Depends(get_orchestrator)]
CurrentUserDep = Annotated[str, Depends(get_current_user)]
SessionManagerDep = Annotated[SpaSessionManager, Depends(get_session_manager)]


class CorrectionRequest(BaseModel):
    documentName: str = Field(..., min_length=1)
    operationType: OperationType


class CorrectionResponse(BaseModel):
    documentName: str
    operationType: OperationType
    createdBy: str
    createdAt: str
    updatedAt: str


class CorrectionsEnvelope(BaseModel):
    jobId: str
    corrections: list[CorrectionResponse]


@router.post("/analysis")
async def create_analysis(
    orchestrator: OrchestratorDep,
    _: CurrentUserDep,
    files: UploadedFiles,
    webhook_url: Optional[str] = None,
):
    if not files:
        raise HTTPException(status_code=400, detail="Nenhum arquivo enviado.")

    job = orchestrator.create_job(files, webhook_url)
    return _serialize_job(job)


@router.post("/session", tags=["auth"])
async def create_session(
    response: Response,
    session_manager: SessionManagerDep,
) -> dict[str, int]:
    state = session_manager.get_session()
    issue_auth_cookies(response, state.access_token, state.refresh_token)
    settings = get_settings()
    response.headers["X-Session-Expires"] = str(int(state.expires_at))
    response.headers["X-Session-Cookie"] = settings.access_token_cookie_name
    return {
        "expiresAt": int(state.expires_at * 1000),
    }


@router.get("/analysis/{job_id}")
async def get_analysis(
    job_id: uuid.UUID,
    orchestrator: OrchestratorDep,
    _: CurrentUserDep,
):
    job = orchestrator.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Análise não encontrada")
    return _serialize_job(job)


@router.get("/analysis/{job_id}/progress")
async def get_progress(
    job_id: uuid.UUID,
    orchestrator: OrchestratorDep,
    _: CurrentUserDep,
):
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
    orchestrator: OrchestratorDep,
):
    async def event_stream() -> AsyncIterator[str]:
        last_payload: Optional[dict] = None
        last_agent_states: Dict[str, dict] = {}
        try:
            while True:
                job = orchestrator.get_job(job_id)
                if not job:
                    yield 'event: error\ndata: {"detail": "Análise não encontrada"}\n\n'
                    return

                payload = _serialize_job(job)
                agent_states = payload.get("agentStates") if isinstance(payload, dict) else {}
                if isinstance(agent_states, dict):
                    for agent, state in agent_states.items():
                        if not isinstance(state, dict):
                            continue
                        previous = last_agent_states.get(agent)
                        if previous != state:
                            progress_event = {
                                "jobId": payload.get("jobId"),
                                "agent": agent,
                                "status": state.get("status"),
                                "progress": state.get("progress", {}),
                            }
                            yield f"event: progress\ndata: {json.dumps(progress_event, default=str)}\n\n"
                    last_agent_states = {
                        agent: deepcopy(state) if isinstance(state, dict) else {}
                        for agent, state in agent_states.items()
                    }

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


@router.get("/analysis/{job_id}/corrections", response_model=CorrectionsEnvelope)
async def get_analysis_corrections(
    job_id: uuid.UUID,
    orchestrator: OrchestratorDep,
    _: CurrentUserDep,
) -> CorrectionsEnvelope:
    job = orchestrator.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Análise não encontrada")

    with get_session() as session:
        corrections = list_corrections(session, job_id)

    return CorrectionsEnvelope(
        jobId=str(job_id),
        corrections=[_serialize_correction(correction) for correction in corrections],
    )


@router.post("/analysis/{job_id}/corrections", response_model=CorrectionsEnvelope)
async def post_analysis_correction(
    job_id: uuid.UUID,
    payload: CorrectionRequest,
    orchestrator: OrchestratorDep,
    user: CurrentUserDep,
) -> CorrectionsEnvelope:
    job = orchestrator.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Análise não encontrada")

    with get_session() as session:
        correction = upsert_correction(
            session,
            job_id,
            payload.documentName,
            payload.operationType,
            user,
        )
        corrections = list_corrections(session, job_id)

    return CorrectionsEnvelope(
        jobId=str(job_id),
        corrections=[_serialize_correction(item) for item in corrections],
    )


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


def _serialize_correction(correction: ClassificationCorrection) -> CorrectionResponse:
    return CorrectionResponse(
        documentName=correction.document_name,
        operationType=correction.operation_type,
        createdBy=correction.created_by,
        createdAt=correction.created_at.isoformat(),
        updatedAt=correction.updated_at.isoformat(),
    )
