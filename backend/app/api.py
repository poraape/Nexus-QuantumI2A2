"""REST API routes."""
from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from .models import AnalysisJob
from .orchestrator import PipelineOrchestrator, orchestrator

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
