"""CRUD helpers for analysis jobs."""
from __future__ import annotations

import uuid
from copy import deepcopy
from typing import Dict, Optional

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from .models import (
    DEFAULT_AGENT_STATES,
    AgentStatus,
    AnalysisJob,
    ClassificationCorrection,
    JobStatus,
    OperationType,
)


def create_job(session: Session, webhook_url: Optional[str] = None) -> AnalysisJob:
    job = AnalysisJob(webhook_url=webhook_url, agent_states=deepcopy(DEFAULT_AGENT_STATES))
    session.add(job)
    session.flush()
    return job


def get_job(session: Session, job_id: uuid.UUID) -> Optional[AnalysisJob]:
    statement = select(AnalysisJob).where(AnalysisJob.id == job_id)
    return session.scalars(statement).first()


def list_corrections(session: Session, job_id: uuid.UUID) -> list[ClassificationCorrection]:
    statement = select(ClassificationCorrection).where(ClassificationCorrection.job_id == job_id)
    return list(session.scalars(statement))


def list_corrections_map(session: Session, job_id: uuid.UUID) -> Dict[str, OperationType]:
    corrections = list_corrections(session, job_id)
    return {correction.document_name: correction.operation_type for correction in corrections}


def upsert_correction(
    session: Session,
    job_id: uuid.UUID,
    document_name: str,
    operation_type: OperationType,
    created_by: str,
) -> ClassificationCorrection:
    statement = select(ClassificationCorrection).where(
        ClassificationCorrection.job_id == job_id,
        ClassificationCorrection.document_name == document_name,
    )
    correction = session.scalars(statement).first()
    if correction is None:
        correction = ClassificationCorrection(
            job_id=job_id,
            document_name=document_name,
            operation_type=operation_type,
            created_by=created_by,
        )
        session.add(correction)
    else:
        correction.operation_type = operation_type
        correction.created_by = created_by
        session.add(correction)

    session.flush()
    session.refresh(correction)
    return correction


def upsert_agent_state(
    session: Session,
    job: AnalysisJob,
    agent: str,
    status: AgentStatus,
    *,
    step: Optional[str] = None,
    current: Optional[int] = None,
    total: Optional[int] = None,
    extra: Optional[Dict[str, object]] = None,
) -> AnalysisJob:
    agent_states = deepcopy(job.agent_states)
    agent_state = agent_states.get(agent, {"status": AgentStatus.PENDING.value, "progress": {}})
    agent_state["status"] = status.value
    progress = agent_state.setdefault("progress", {})
    if step is not None:
        progress["step"] = step
    if current is not None:
        progress["current"] = current
    if total is not None:
        progress["total"] = total
    if extra:
        progress.update(extra)
    agent_states[agent] = agent_state

    session.execute(
        update(AnalysisJob)
        .where(AnalysisJob.id == job.id)
        .values(agent_states=agent_states, updated_at=job.updated_at)
    )
    session.flush()
    session.refresh(job)
    return job


def set_job_status(
    session: Session,
    job: AnalysisJob,
    status: JobStatus,
    *,
    error_message: Optional[str] = None,
    result_payload: Optional[Dict[str, object]] = None,
) -> AnalysisJob:
    job.status = status
    job.error_message = error_message
    if result_payload is not None:
        job.result_payload = result_payload
    session.add(job)
    session.flush()
    session.refresh(job)
    return job
