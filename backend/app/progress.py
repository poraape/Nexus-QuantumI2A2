"""Progress update utilities for Celery tasks."""
from __future__ import annotations

import uuid
from typing import Dict, Optional

import httpx

from .config import settings
from .crud import get_job, set_job_status, upsert_agent_state
from .database import get_session
from .models import AgentStatus, JobStatus


def update_agent(
    job_id: uuid.UUID,
    agent: str,
    status: AgentStatus,
    *,
    step: Optional[str] = None,
    current: Optional[int] = None,
    total: Optional[int] = None,
    extra: Optional[Dict[str, object]] = None,
) -> None:
    with get_session() as session:
        job = get_job(session, job_id)
        if not job:
            return
        upsert_agent_state(
            session,
            job,
            agent,
            status,
            step=step,
            current=current,
            total=total,
            extra=extra,
        )
        _send_webhook(job)


def set_job_result(
    job_id: uuid.UUID,
    status: JobStatus,
    *,
    error_message: Optional[str] = None,
    result_payload: Optional[Dict[str, object]] = None,
) -> None:
    with get_session() as session:
        job = get_job(session, job_id)
        if not job:
            return
        set_job_status(
            session,
            job,
            status,
            error_message=error_message,
            result_payload=result_payload,
        )
        _send_webhook(job)


def _send_webhook(job) -> None:
    if not job.webhook_url:
        return
    payload = {
        "jobId": str(job.id),
        "status": job.status.value,
        "agentStates": job.agent_states,
        "error": job.error_message,
    }
    if job.result_payload is not None:
        payload["result"] = job.result_payload

    try:
        with httpx.Client(timeout=settings.webhook_timeout_seconds) as client:
            client.post(job.webhook_url, json=payload)
    except Exception:
        # Webhook failures should not break the pipeline
        pass
