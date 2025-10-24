"""Classifier agent task."""
from __future__ import annotations

import time
import uuid
from typing import Dict, List

from celery import shared_task

from ..models import AgentStatus
from ..progress import update_agent
from .base import ensure_pipeline_result


@shared_task(name="agents.classifier")
def run_classifier(payload: Dict[str, object]) -> Dict[str, object]:
    job_id = uuid.UUID(payload["job_id"])
    update_agent(job_id, "classifier", AgentStatus.RUNNING, step="Classificando documento")
    pipeline_result = ensure_pipeline_result(job_id, payload)
    classification = pipeline_result.get("classification", {})
    update_agent(
        job_id,
        "classifier",
        AgentStatus.COMPLETED,
        extra={"confidence": classification.get("confidence")},
    )
    return pipeline_result.get("insight", {})
