"""OCR agent task backed by the synchronous orchestrator."""
from __future__ import annotations

import uuid
from typing import Dict

from celery import shared_task

from ..models import AgentStatus
from ..progress import update_agent
from .base import execute_pipeline, serialize_pipeline_result


@shared_task(name="agents.ocr")
def run_ocr(payload: Dict[str, object]) -> Dict[str, object]:
    job_id = uuid.UUID(payload["job_id"])
    document_data = payload["document"]  # type: ignore[index]

    update_agent(job_id, "ocr", AgentStatus.RUNNING, step="Extraindo documento")
    result = execute_pipeline(job_id, document_data)  # type: ignore[arg-type]
    payload["pipeline_result"] = serialize_pipeline_result(result)
    update_agent(
        job_id,
        "ocr",
        AgentStatus.COMPLETED,
        extra={"documentId": result.document.document_id, "insight": result.insight.title},
    )
    return payload["pipeline_result"]["insight"]  # type: ignore[index]
