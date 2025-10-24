"""OCR agent task."""
from __future__ import annotations

import time
import uuid
from typing import Dict, List

from celery import shared_task

from ..models import AgentStatus
from ..progress import update_agent
from ..services.ocr_service import extract_text_from_file
from ..telemetry import telemetry


@shared_task(name="agents.ocr")
def run_ocr(context: Dict[str, object]) -> Dict[str, object]:
    job_id = uuid.UUID(context["job_id"])
    update_agent(job_id, "ocr", AgentStatus.RUNNING, step="Processando arquivos")
    files = context.get("files", [])
    documents: List[Dict[str, object]] = []
    start = time.monotonic()
    try:
        for index, file_info in enumerate(files, start=1):
            text_payload = ""
            if isinstance(file_info, dict) and file_info.get("path"):
                text_payload = extract_text_from_file(str(file_info["path"]))
            documents.append({
                "name": file_info.get("filename", f"documento_{index}"),
                "status": "OK",
                "data": [{"type": "text", "content": text_payload}] if text_payload else [],
            })
            update_agent(
                job_id,
                "ocr",
                AgentStatus.RUNNING,
                step="Processando arquivos",
                current=index,
                total=len(files) if files else 0,
            )
        context["documents"] = documents
        update_agent(job_id, "ocr", AgentStatus.COMPLETED, extra={"documents": len(documents)})
    except Exception as exc:  # pragma: no cover - defensive
        duration_ms = (time.monotonic() - start) * 1000
        telemetry.record_latency(
            "ocr",
            "run",
            duration_ms,
            {
                "job_id": str(job_id),
                "status": "error",
                "error_type": type(exc).__name__,
            },
        )
        telemetry.record_error(
            "ocr",
            "run",
            {"job_id": str(job_id), "error_type": type(exc).__name__},
        )
        raise
    else:
        duration_ms = (time.monotonic() - start) * 1000
        telemetry.record_latency(
            "ocr",
            "run",
            duration_ms,
            {"job_id": str(job_id), "documents": len(documents), "status": "success"},
        )
        telemetry.record_success(
            "ocr",
            "run",
            {"job_id": str(job_id), "documents": len(documents)},
        )
        return context
