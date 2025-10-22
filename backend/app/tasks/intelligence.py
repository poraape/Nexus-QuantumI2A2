"""Intelligence agent task."""
from __future__ import annotations

import uuid
from typing import Dict

from celery import shared_task

from ..models import AgentStatus
from ..progress import update_agent
from .base import _simulate_work


@shared_task(name="agents.intelligence")
def run_intelligence(context: Dict[str, object]) -> Dict[str, object]:
    job_id = uuid.UUID(context["job_id"])
    update_agent(job_id, "intelligence", AgentStatus.RUNNING, step="Gerando insights com IA")
    _simulate_work()
    insights = {
        "aiDrivenInsights": [],
        "crossValidationResults": [],
    }
    update_agent(job_id, "intelligence", AgentStatus.COMPLETED, extra={"insights": len(insights["aiDrivenInsights"])})
    context["intelligence"] = insights
    return context
