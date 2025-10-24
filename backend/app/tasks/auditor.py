"""Auditor agent task."""
from __future__ import annotations

import time
import uuid
from typing import Dict, List

from celery import shared_task

from ..models import AgentStatus
from ..progress import update_agent
from .base import ensure_pipeline_result


@shared_task(name="agents.auditor")
def run_auditor(payload: Dict[str, object]) -> Dict[str, object]:
    job_id = uuid.UUID(payload["job_id"])
    update_agent(job_id, "auditor", AgentStatus.RUNNING, step="Validando documento")
    pipeline_result = ensure_pipeline_result(job_id, payload)
    audit_summary = pipeline_result.get("audit", {})
    update_agent(
        job_id,
        "auditor",
        AgentStatus.COMPLETED,
        extra={"issues": len(audit_summary.get("issues", []))},
    )
    return pipeline_result.get("insight", {})
