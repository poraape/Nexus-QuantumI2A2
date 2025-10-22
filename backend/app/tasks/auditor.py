"""Auditor agent task."""
from __future__ import annotations

import uuid
from typing import Dict

from celery import shared_task

from ..models import AgentStatus
from ..progress import update_agent
from .base import _simulate_work


@shared_task(name="agents.auditor")
def run_auditor(context: Dict[str, object]) -> Dict[str, object]:
    job_id = uuid.UUID(context["job_id"])
    update_agent(job_id, "auditor", AgentStatus.RUNNING, step="Validando documentos")
    _simulate_work()
    audit_summary = {
        "totalDocuments": len(context.get("documents", [])),
        "issues": [],
    }
    update_agent(job_id, "auditor", AgentStatus.COMPLETED, extra={"issues": len(audit_summary["issues"])})
    context["audit"] = audit_summary
    return context
