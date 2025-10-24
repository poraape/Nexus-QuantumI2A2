"""Intelligence agent task."""
from __future__ import annotations

import json
import time
import uuid
from typing import Dict

from celery import shared_task

from ..models import AgentStatus
from ..progress import update_agent
from .base import ensure_pipeline_result


@shared_task(name="agents.intelligence")
def run_intelligence(payload: Dict[str, object]) -> Dict[str, object]:
    job_id = uuid.UUID(payload["job_id"])
    update_agent(job_id, "intelligence", AgentStatus.RUNNING, step="Gerando insights com IA")
    pipeline_result = ensure_pipeline_result(job_id, payload)
    insight = pipeline_result.get("insight", {})
    update_agent(
        job_id,
        "intelligence",
        AgentStatus.COMPLETED,
        extra={"recommendations": len(insight.get("recommendations", []))},
    )
    return insight
