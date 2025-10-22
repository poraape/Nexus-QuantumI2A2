"""Common utilities shared between Celery tasks."""
from __future__ import annotations

import time
import uuid
from typing import Any, Dict

from ..models import AgentStatus, JobStatus
from ..progress import set_job_result, update_agent


def _simulate_work(duration: float = 0.5) -> None:
    time.sleep(duration)


def update_agent_running(job_id: uuid.UUID, agent: str, step: str) -> None:
    update_agent(job_id, agent, AgentStatus.RUNNING, step=step)


def update_agent_completed(job_id: uuid.UUID, agent: str, extra: Dict[str, Any] | None = None) -> None:
    update_agent(job_id, agent, AgentStatus.COMPLETED, extra=extra)


def mark_failed(job_id: uuid.UUID, agent: str, error: Exception) -> None:
    update_agent(job_id, agent, AgentStatus.ERROR, extra={"error": str(error)})
    set_job_result(job_id, status=JobStatus.FAILED, error_message=str(error))
