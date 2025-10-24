"""CRUD helpers for analysis jobs."""
from __future__ import annotations

import uuid
from datetime import datetime
from copy import deepcopy
from typing import Dict, Optional

try:  # pragma: no cover - optional dependency
    from sqlalchemy import select, update
    from sqlalchemy.orm import Session

    SQLALCHEMY_AVAILABLE = True
except ModuleNotFoundError:  # pragma: no cover - lightweight fallback
    SQLALCHEMY_AVAILABLE = False
    Session = object  # type: ignore[assignment]

from .models import (
    DEFAULT_AGENT_STATES,
    AgentStatus,
    AnalysisJob,
    ClassificationCorrection,
    JobStatus,
    OperationType,
)

if SQLALCHEMY_AVAILABLE:

    def create_job(session: Session, webhook_url: Optional[str] = None) -> AnalysisJob:
        job = AnalysisJob(webhook_url=webhook_url, agent_states=deepcopy(DEFAULT_AGENT_STATES))
        session.add(job)
        session.flush()
        return job


    def get_job(session: Session, job_id: uuid.UUID) -> Optional[AnalysisJob]:
        statement = select(AnalysisJob).where(AnalysisJob.id == job_id)
        return session.scalars(statement).first()


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

else:
    _JOB_STORE: Dict[uuid.UUID, AnalysisJob] = {}

    def create_job(_session: object, webhook_url: Optional[str] = None) -> AnalysisJob:
        job = AnalysisJob(webhook_url=webhook_url, agent_states=deepcopy(DEFAULT_AGENT_STATES))
        _JOB_STORE[job.id] = job
        return job


    def get_job(_session: object, job_id: uuid.UUID) -> Optional[AnalysisJob]:
        return _JOB_STORE.get(job_id)


    def upsert_agent_state(
        _session: object,
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
        job.agent_states = agent_states
        job.updated_at = datetime.utcnow()
        return job


    def set_job_status(
        _session: object,
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
        job.updated_at = datetime.utcnow()
        return job
