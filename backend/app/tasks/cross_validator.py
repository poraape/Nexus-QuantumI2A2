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
    operations = build_operations_from_pipeline(pipeline_result)
    if operations:
        pipeline_result["operations"] = operations
    update_agent(
        job_id,
        "crossValidator",
        AgentStatus.COMPLETED,
        extra={"comparisons": len(operations)},
    )
    return pipeline_result.get("insight", {})
