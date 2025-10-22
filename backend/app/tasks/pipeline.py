"""Pipeline orchestration task chain."""
from __future__ import annotations

import datetime as dt
import uuid
from typing import Dict

from celery import chain, shared_task

from ..models import JobStatus
from ..progress import set_job_result
from .accountant import run_accountant
from .auditor import run_auditor
from .classifier import run_classifier
from .cross_validator import run_cross_validator
from .intelligence import run_intelligence
from .ocr import run_ocr


@shared_task(name="pipeline.run")
def run_pipeline(context: Dict[str, object]) -> None:
    job_id = uuid.UUID(context["job_id"])
    context.setdefault("started_at", dt.datetime.utcnow().isoformat())

    workflow = chain(
        run_ocr.s(),
        run_auditor.s(),
        run_classifier.s(),
        run_cross_validator.s(),
        run_intelligence.s(),
        run_accountant.s(),
    )
    try:
        result = workflow.apply_async((context,))
        context = result.get(disable_sync_subtasks=False)
    except Exception as exc:  # pragma: no cover - defensive
        set_job_result(job_id, JobStatus.FAILED, error_message=str(exc))
        raise
    else:
        set_job_result(job_id, JobStatus.COMPLETED, result_payload=context.get("report"))
