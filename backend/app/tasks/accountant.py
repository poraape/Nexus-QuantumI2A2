"""Accountant agent task."""
from __future__ import annotations

import time
import uuid
from typing import Dict, List

from celery import shared_task

from ..models import AgentStatus
from ..progress import update_agent
from ..tax import icms_service
from ..telemetry import telemetry


@shared_task(name="agents.accountant")
def run_accountant(context: Dict[str, object]) -> Dict[str, object]:
    job_id = uuid.UUID(context["job_id"])
    update_agent(job_id, "accountant", AgentStatus.RUNNING, step="Consolidando relatório fiscal")
    start = time.monotonic()
    try:
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
    except Exception as exc:  # pragma: no cover - defensive
        duration_ms = (time.monotonic() - start) * 1000
        telemetry.record_latency(
            "accountant",
            "run",
            duration_ms,
            {"job_id": str(job_id), "status": "error", "error_type": type(exc).__name__},
        )
        telemetry.record_error(
            "accountant",
            "run",
            {"job_id": str(job_id), "error_type": type(exc).__name__},
        )
        raise
    else:
        duration_ms = (time.monotonic() - start) * 1000
        telemetry.record_latency(
            "accountant",
            "run",
            duration_ms,
            {
                "job_id": str(job_id),
                "status": "success",
                "operations": len(context.get("operations", [])),
                "icms_operations": context["report"]["fiscal"]["icms"]["totals"]["operations"],
            },
        )
        telemetry.record_success(
            "accountant",
            "run",
            {"job_id": str(job_id), "icms_operations": context["report"]["fiscal"]["icms"]["totals"]["operations"]},
        )
        return context
