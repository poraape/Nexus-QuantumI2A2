"""Cross-validation agent task."""
from __future__ import annotations

import time
import uuid
from typing import Dict, List

from celery import shared_task

from ..models import AgentStatus
from ..progress import update_agent
from .base import build_operations_from_pipeline, ensure_pipeline_result


@shared_task(name="agents.cross_validator")
def run_cross_validator(payload: Dict[str, object]) -> Dict[str, object]:
    job_id = uuid.UUID(payload["job_id"])
    update_agent(job_id, "crossValidator", AgentStatus.RUNNING, step="Executando validação cruzada")
    pipeline_result = ensure_pipeline_result(job_id, payload)
    cross_validation = pipeline_result.get("cross_validation")
    operations = []
    if isinstance(cross_validation, dict):
        operations = cross_validation.get("operations", [])  # type: ignore[assignment]

    if not operations:
        operations = build_operations_from_pipeline(pipeline_result)
        if operations:
            cross_validation = cross_validation or {}
            cross_validation["operations"] = operations
            pipeline_result["cross_validation"] = cross_validation
    update_agent(
        job_id,
        "crossValidator",
        AgentStatus.COMPLETED,
        extra={"comparisons": len(operations)},
    )
    return pipeline_result.get("insight", {})
