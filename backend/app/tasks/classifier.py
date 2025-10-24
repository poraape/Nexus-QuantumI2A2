"""Classifier agent task."""
from __future__ import annotations

import time
import uuid
from typing import Dict, List

from celery import shared_task

from ..models import AgentStatus
from ..progress import update_agent
from ..services import nlp_service
from ..telemetry import telemetry


@shared_task(name="agents.classifier")
def run_classifier(context: Dict[str, object]) -> Dict[str, object]:
    job_id = uuid.UUID(context["job_id"])
    update_agent(job_id, "classifier", AgentStatus.RUNNING, step="Classificando operações")
    start = time.monotonic()
    try:
        documents = context.get("documents", [])
        extracted_items: List[Dict[str, object]] = []
        for document in documents:
            for fragment in document.get("data", []):
                if isinstance(fragment, dict) and fragment.get("type") == "text":
                    extracted_items.extend(nlp_service.extract_entities(fragment.get("content", "")))

        categories: Dict[str, Dict[str, float | int]] = {}
        for item in extracted_items:
            sku = str(item.get("sku", "unknown"))
            category = categories.setdefault(sku, {"total": 0.0, "items": 0})
            category["total"] = float(category["total"]) + float(item.get("total_value", 0.0))
            category["items"] = int(category["items"]) + 1

        classification = {
            "categories": categories,
            "summary": {
                "items": len(extracted_items),
                "documents": len(documents),
            },
        }
        context["classification"] = classification
        update_agent(
            job_id,
            "classifier",
            AgentStatus.COMPLETED,
            extra={"categories": len(classification["categories"]), "items": len(extracted_items)},
        )
    except Exception as exc:  # pragma: no cover - defensive
        duration_ms = (time.monotonic() - start) * 1000
        telemetry.record_latency(
            "classifier",
            "run",
            duration_ms,
            {"job_id": str(job_id), "status": "error", "error_type": type(exc).__name__},
        )
        telemetry.record_error(
            "classifier",
            "run",
            {"job_id": str(job_id), "error_type": type(exc).__name__},
        )
        raise
    else:
        duration_ms = (time.monotonic() - start) * 1000
        telemetry.record_latency(
            "classifier",
            "run",
            duration_ms,
            {
                "job_id": str(job_id),
                "status": "success",
                "items": len(extracted_items),
                "categories": len(categories),
            },
        )
        telemetry.record_success(
            "classifier",
            "run",
            {"job_id": str(job_id), "items": len(extracted_items)},
        )
        return context
