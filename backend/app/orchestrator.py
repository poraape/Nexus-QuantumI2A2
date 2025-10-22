"""High-level orchestrator for analysis pipelines."""
from __future__ import annotations

import uuid
from typing import Iterable, List, Optional

from fastapi import UploadFile

from .crud import create_job, get_job
from .database import get_session
from .models import AnalysisJob, JobStatus
from .progress import set_job_result
from .storage import store_uploads
from .tasks.pipeline import run_pipeline


class PipelineOrchestrator:
    """Coordinates job creation and Celery orchestration."""

    def create_job(self, files: Iterable[UploadFile], webhook_url: Optional[str] = None) -> AnalysisJob:
        with get_session() as session:
            job = create_job(session, webhook_url=webhook_url)
        stored_files = store_uploads(job.id, files)
        payload_files: List[dict] = [
            {"path": stored.path, "content_type": stored.content_type, "filename": stored.filename}
            for stored in stored_files
        ]
        context = {"job_id": str(job.id), "files": payload_files}
        set_job_result(job.id, JobStatus.RUNNING)
        run_pipeline.apply_async(args=(context,))
        return self.get_job(job.id)

    def get_job(self, job_id: uuid.UUID) -> Optional[AnalysisJob]:
        with get_session() as session:
            return get_job(session, job_id)


orchestrator = PipelineOrchestrator()
