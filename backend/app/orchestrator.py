"""High-level orchestrator for analysis pipelines."""
from __future__ import annotations

import uuid
from pathlib import Path
from typing import Iterable, List, Optional

from fastapi import UploadFile

from .crud import create_job, get_job
from .database import get_session
from .models import DEFAULT_AGENT_STATES, AgentStatus, AnalysisJob, JobStatus
from .progress import set_job_result, update_agent
from .services.orchestrator.budget import BudgetViolation, TokenBudgetManager
from .storage import store_uploads
from .tasks.pipeline import run_pipeline


class PipelineOrchestrator:
    """Coordinates job creation and Celery orchestration."""

    def create_job(self, files: Iterable[UploadFile], webhook_url: Optional[str] = None) -> AnalysisJob:
        with get_session() as session:
            job = create_job(session, webhook_url=webhook_url)
        stored_files = store_uploads(job.id, files)
        payload_files: List[dict] = []
        for stored in stored_files:
            size_bytes = 0
            try:
                size_bytes = Path(stored.path).stat().st_size
            except OSError:  # pragma: no cover - filesystem edge cases
                size_bytes = 0
            metadata = {"size_bytes": size_bytes}
            payload_files.append(
                {
                    "path": stored.path,
                    "content_type": stored.content_type,
                    "filename": stored.filename,
                    "size_bytes": size_bytes,
                    "metadata": metadata,
                }
            )

        budget_manager = TokenBudgetManager.from_settings()
        usage = budget_manager.estimate_job_usage(payload_files)
        violations = budget_manager.validate_preflight(usage)
        if violations:
            self._emit_budget_fallback(job.id, payload_files, violations)
            return self.get_job(job.id)

        context = {
            "job_id": str(job.id),
            "files": payload_files,
            "token_budget": budget_manager.snapshot(),
        }
        set_job_result(job.id, JobStatus.RUNNING)
        run_pipeline.apply_async(args=(context,))
        return self.get_job(job.id)

    def _emit_budget_fallback(
        self,
        job_id: uuid.UUID,
        payload_files: Iterable[dict],
        violations: Iterable[BudgetViolation],
    ) -> None:
        reason = "Orçamento de tokens excedido; executando fallback local."
        documents = [
            {
                "filename": file_info.get("filename"),
                "sizeBytes": file_info.get("size_bytes", 0),
            }
            for file_info in payload_files
        ]
        violation_payload = [
            {
                "scope": violation.scope,
                "identifier": violation.identifier,
                "requested": violation.requested,
                "limit": violation.limit,
            }
            for violation in violations
        ]
        for agent in DEFAULT_AGENT_STATES.keys():
            update_agent(
                job_id,
                agent,
                AgentStatus.COMPLETED,
                extra={"fallback": True, "reason": reason},
            )

        set_job_result(
            job_id,
            JobStatus.COMPLETED,
            result_payload={
                "fallback": "local",
                "reason": reason,
                "documents": documents,
                "violations": violation_payload,
            },
        )

    def get_job(self, job_id: uuid.UUID) -> Optional[AnalysisJob]:
        with get_session() as session:
            return get_job(session, job_id)


orchestrator = PipelineOrchestrator()
