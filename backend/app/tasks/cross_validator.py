"""Cross-validation agent task."""
from __future__ import annotations

import time
import uuid
from typing import Dict, List

from celery import shared_task

from ..models import AgentStatus
from ..progress import update_agent
from ..telemetry import telemetry


def _build_operations(documents: List[Dict[str, object]]) -> List[Dict[str, object]]:
    operations: List[Dict[str, object]] = []
    if not documents:
        return operations
    ufs = ["SP", "RJ", "MG", "ES"]
    sample_ncms = ["27101932", "87032310", "30049099", "00000000"]
    for index, document in enumerate(documents):
        operations.append(
            {
                "id": f"op-{index + 1}",
                "document": document.get("name"),
                "uf": ufs[index % len(ufs)],
                "ncm": sample_ncms[index % len(sample_ncms)],
                "value": float(1000 + 150 * index),
            }
        )
    return operations


@shared_task(name="agents.cross_validator")
def run_cross_validator(context: Dict[str, object]) -> Dict[str, object]:
    job_id = uuid.UUID(context["job_id"])
    update_agent(job_id, "crossValidator", AgentStatus.RUNNING, step="Executando validação cruzada")
    start = time.monotonic()
    inconsistencies: List[Dict[str, object]] = []
    try:
        documents: List[Dict[str, object]] = context.get("documents", [])
        operations = _build_operations(documents)
        if operations:
            context["operations"] = operations
        inconsistencies = [
            operation
            for operation in operations
            if operation.get("ncm") == "00000000" or float(operation.get("value", 0)) <= 0
        ]
        if inconsistencies:
            context["inconsistencies"] = inconsistencies
        update_agent(
            job_id,
            "crossValidator",
            AgentStatus.COMPLETED,
            extra={"comparisons": len(operations), "inconsistencies": len(inconsistencies)},
        )
    except Exception as exc:  # pragma: no cover - defensive
        duration_ms = (time.monotonic() - start) * 1000
        telemetry.record_latency(
            "crossValidator",
            "run",
            duration_ms,
            {"job_id": str(job_id), "status": "error", "error_type": type(exc).__name__},
        )
        telemetry.record_error(
            "crossValidator",
            "run",
            {"job_id": str(job_id), "error_type": type(exc).__name__},
        )
        raise
    else:
        duration_ms = (time.monotonic() - start) * 1000
        telemetry.record_latency(
            "crossValidator",
            "run",
            duration_ms,
            {
                "job_id": str(job_id),
                "status": "success",
                "operations": len(context.get("operations", [])),
                "inconsistencies": len(inconsistencies),
            },
        )
        telemetry.record_success(
            "crossValidator",
            "run",
            {"job_id": str(job_id), "operations": len(context.get("operations", []))},
        )
        telemetry.record_inconsistency(
            "crossValidator",
            "run",
            len(inconsistencies),
            {"job_id": str(job_id)},
        )
        return context
