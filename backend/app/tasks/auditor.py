"""Auditor agent task."""
from __future__ import annotations

import time
import uuid
from typing import Dict, List

from celery import shared_task

from ..models import AgentStatus
from ..progress import update_agent
from ..telemetry import telemetry


@shared_task(name="agents.auditor")
def run_auditor(context: Dict[str, object]) -> Dict[str, object]:
    job_id = uuid.UUID(context["job_id"])
    update_agent(job_id, "auditor", AgentStatus.RUNNING, step="Validando documentos")
    documents = context.get("documents", [])
    start = time.monotonic()
    try:
        issues: List[Dict[str, object]] = []
        for document in documents:
            if not document.get("data"):
                issues.append({
                    "document": document.get("name"),
                    "issue": "Documento sem conteúdo extraído",
                    "severity": "medium",
                })
        audit_summary = {
            "totalDocuments": len(documents),
            "issues": issues,
        }
        context["audit"] = audit_summary
        update_agent(
            job_id,
            "auditor",
            AgentStatus.COMPLETED,
            extra={"issues": len(audit_summary["issues"])},
        )
    except Exception as exc:  # pragma: no cover - defensive
        duration_ms = (time.monotonic() - start) * 1000
        telemetry.record_latency(
            "auditor",
            "run",
            duration_ms,
            {"job_id": str(job_id), "status": "error", "error_type": type(exc).__name__},
        )
        telemetry.record_error(
            "auditor",
            "run",
            {"job_id": str(job_id), "error_type": type(exc).__name__},
        )
        raise
    else:
        duration_ms = (time.monotonic() - start) * 1000
        telemetry.record_latency(
            "auditor",
            "run",
            duration_ms,
            {"job_id": str(job_id), "status": "success", "issues": len(audit_summary["issues"])},
        )
        telemetry.record_success(
            "auditor",
            "run",
            {"job_id": str(job_id), "issues": len(audit_summary["issues"])},
        )
        return context
