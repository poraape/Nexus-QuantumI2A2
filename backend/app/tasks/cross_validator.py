"""Cross-validation agent task."""
from __future__ import annotations

import uuid
from typing import Dict, List

from celery import shared_task

from ..models import AgentStatus
from ..progress import update_agent
from .base import _simulate_work


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
    _simulate_work()
    documents: List[Dict[str, object]] = context.get("documents", [])
    operations = _build_operations(documents)
    if operations:
        context["operations"] = operations
    update_agent(
        job_id,
        "crossValidator",
        AgentStatus.COMPLETED,
        extra={"comparisons": len(operations)},
    )
    return context
