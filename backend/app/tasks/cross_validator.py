"""Cross-validation agent task."""
from __future__ import annotations

import uuid
from typing import Dict

from celery import shared_task

from ..models import AgentStatus
from ..progress import update_agent
from .base import _simulate_work


@shared_task(name="agents.cross_validator")
def run_cross_validator(context: Dict[str, object]) -> Dict[str, object]:
    job_id = uuid.UUID(context["job_id"])
    update_agent(job_id, "crossValidator", AgentStatus.RUNNING, step="Executando validação cruzada")
    _simulate_work()
    update_agent(job_id, "crossValidator", AgentStatus.COMPLETED, extra={"comparisons": 0})
    return context
