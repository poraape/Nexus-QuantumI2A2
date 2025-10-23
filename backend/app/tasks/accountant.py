"""Accountant agent task."""
from __future__ import annotations

import uuid
from typing import Dict, List

from celery import shared_task

from ..models import AgentStatus
from ..progress import update_agent
from ..tax import icms_service
from .base import _simulate_work


@shared_task(name="agents.accountant")
def run_accountant(context: Dict[str, object]) -> Dict[str, object]:
    job_id = uuid.UUID(context["job_id"])
    update_agent(job_id, "accountant", AgentStatus.RUNNING, step="Consolidando relatório fiscal")
    _simulate_work()

    operations: List[Dict[str, object]] = context.get("operations", [])  # type: ignore[assignment]
    icms_payload = icms_service.calculate_for_operations(operations)
    if icms_payload["entries"]:
        icms_service.write_report(job_id, icms_payload)

    report = {
        "summary": {
            "title": "Análise Fiscal Automatizada",
            "generatedAt": context.get("started_at"),
        },
        "documents": context.get("documents", []),
        "audit": context.get("audit", {}),
        "classification": context.get("classification", {}),
        "insights": context.get("intelligence", {}),
        "fiscal": {"icms": icms_payload},
    }
    context["report"] = report
    update_agent(
        job_id,
        "accountant",
        AgentStatus.COMPLETED,
        extra={"sections": len(report), "icms_operations": icms_payload["totals"]["operations"]},
    )
    return context
