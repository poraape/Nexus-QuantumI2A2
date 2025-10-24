"""Intelligence agent task."""
from __future__ import annotations

import json
import time
import uuid
from typing import Dict

from celery import shared_task

from ..models import AgentStatus
from ..progress import update_agent
from ..services.llm_service import service as llm_service
from ..telemetry import telemetry


@shared_task(name="agents.intelligence")
def run_intelligence(context: Dict[str, object]) -> Dict[str, object]:
    job_id = uuid.UUID(context["job_id"])
    update_agent(job_id, "intelligence", AgentStatus.RUNNING, step="Gerando insights com IA")
    start = time.monotonic()
    try:
        classification = context.get("classification", {})
        operations = context.get("operations", [])
        prompt_payload = {
            "classification": classification,
            "operations": operations,
            "inconsistencies": context.get("inconsistencies", []),
        }
        prompt = json.dumps(prompt_payload)
        llm_result = llm_service.run(prompt, schema={"type": "object"})
        insights = {
            "aiDrivenInsights": [llm_result],
            "crossValidationResults": operations,
        }
        context["intelligence"] = insights
        update_agent(
            job_id,
            "intelligence",
            AgentStatus.COMPLETED,
            extra={"insights": len(insights["aiDrivenInsights"])},
        )
    except Exception as exc:  # pragma: no cover - defensive
        duration_ms = (time.monotonic() - start) * 1000
        telemetry.record_latency(
            "intelligence",
            "run",
            duration_ms,
            {"job_id": str(job_id), "status": "error", "error_type": type(exc).__name__},
        )
        telemetry.record_error(
            "intelligence",
            "run",
            {"job_id": str(job_id), "error_type": type(exc).__name__},
        )
        raise
    else:
        duration_ms = (time.monotonic() - start) * 1000
        telemetry.record_latency(
            "intelligence",
            "run",
            duration_ms,
            {
                "job_id": str(job_id),
                "status": "success",
                "insights": len(context.get("intelligence", {}).get("aiDrivenInsights", [])),
            },
        )
        telemetry.record_success(
            "intelligence",
            "run",
            {"job_id": str(job_id), "insights": len(context.get("intelligence", {}).get("aiDrivenInsights", []))},
        )
        return context
