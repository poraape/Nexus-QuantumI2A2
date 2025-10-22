"""Accountant agent task."""
from __future__ import annotations

import uuid
from typing import Dict

from celery import shared_task

from ..models import AgentStatus
from ..progress import update_agent
from .base import _simulate_work


@shared_task(name="agents.accountant")
def run_accountant(context: Dict[str, object]) -> Dict[str, object]:
    job_id = uuid.UUID(context["job_id"])
    update_agent(job_id, "accountant", AgentStatus.RUNNING, step="Consolidando relatório fiscal")
    _simulate_work()
    report = {
        "summary": {
            "title": "Análise Fiscal Automatizada",
            "generatedAt": context.get("started_at"),
        },
        "documents": context.get("documents", []),
        "audit": context.get("audit", {}),
        "classification": context.get("classification", {}),
        "insights": context.get("intelligence", {}),
    }
    update_agent(job_id, "accountant", AgentStatus.COMPLETED, extra={"sections": len(report)})
    context["report"] = report
    return context
