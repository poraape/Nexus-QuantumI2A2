"""Accountant agent task."""
from __future__ import annotations

import uuid
from typing import Dict, List

from celery import shared_task

from ..models import AgentStatus
from ..progress import update_agent
from ..tax import icms_service
from .base import build_operations_from_pipeline, ensure_pipeline_result


@shared_task(name="agents.accountant")
def run_accountant(payload: Dict[str, object]) -> Dict[str, object]:
    job_id = uuid.UUID(payload["job_id"])
    update_agent(job_id, "accountant", AgentStatus.RUNNING, step="Consolidando relatório fiscal")

    pipeline_result = ensure_pipeline_result(job_id, payload)
    operations: List[Dict[str, object]] = pipeline_result.get("operations") or build_operations_from_pipeline(
        pipeline_result
    )
    # type: ignore[assignment]
    icms_payload = icms_service.calculate_for_operations(operations)
    if icms_payload["entries"]:
        icms_service.write_report(job_id, icms_payload)

    report = {
        "summary": {
            "title": "Análise Fiscal Automatizada",
            "generatedAt": payload.get("started_at"),
        },
        "document": pipeline_result.get("document", {}),
        "audit": pipeline_result.get("audit", {}),
        "classification": pipeline_result.get("classification", {}),
        "insight": pipeline_result.get("insight", {}),
        "fiscal": {"icms": icms_payload},
    }
    pipeline_result["report"] = report
    update_agent(
        job_id,
        "accountant",
        AgentStatus.COMPLETED,
        extra={"sections": len(report), "icms_operations": icms_payload["totals"]["operations"]},
    )
    return pipeline_result.get("insight", {})
