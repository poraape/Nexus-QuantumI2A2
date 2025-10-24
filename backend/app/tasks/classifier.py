"""Classifier agent task."""
from __future__ import annotations

import uuid
from typing import Dict

from celery import shared_task

from ..models import AgentStatus
from ..progress import update_agent
from .base import _simulate_work


@shared_task(name="agents.classifier")
def run_classifier(context: Dict[str, object]) -> Dict[str, object]:
    job_id = uuid.UUID(context["job_id"])
    update_agent(job_id, "classifier", AgentStatus.RUNNING, step="Classificando operações")
    _simulate_work()
    corrections = context.get("corrections") if isinstance(context, dict) else None
    classification = {
        "categories": {},
        "summary": {},
    }
    applied = 0
    if isinstance(corrections, dict) and corrections:
        classification["categories"] = {
            document: {"operationType": operation, "confidence": 1.0}
            for document, operation in corrections.items()
        }
        applied = len(classification["categories"])
        classification["summary"]["appliedCorrections"] = applied

    update_agent(
        job_id,
        "classifier",
        AgentStatus.COMPLETED,
        extra={"categories": len(classification["categories"]), "appliedCorrections": applied},
    )
    context["classification"] = classification
    return context
