"""OCR agent task."""
from __future__ import annotations

import uuid
from typing import Dict, List

from celery import shared_task

from ..models import AgentStatus
from ..progress import update_agent
from .base import _simulate_work


@shared_task(name="agents.ocr")
def run_ocr(context: Dict[str, object]) -> Dict[str, object]:
    job_id = uuid.UUID(context["job_id"])
    update_agent(job_id, "ocr", AgentStatus.RUNNING, step="Processando arquivos")
    _simulate_work()
    files = context.get("files", [])
    documents: List[Dict[str, object]] = []
    for index, file_info in enumerate(files, start=1):
        documents.append({
            "name": file_info.get("filename", f"documento_{index}"),
            "status": "OK",
            "data": [],
        })
        update_agent(
            job_id,
            "ocr",
            AgentStatus.RUNNING,
            step="Processando arquivos",
            current=index,
            total=len(files) if files else 0,
        )
    update_agent(job_id, "ocr", AgentStatus.COMPLETED, extra={"documents": len(documents)})
    context["documents"] = documents
    return context
