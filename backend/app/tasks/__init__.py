"""Tarefas Celery stubs."""
from __future__ import annotations

import importlib.util

from ..orchestrator.state_machine import build_pipeline
from ..schemas import DocumentIn
from ..utils import model_dump

if celery_spec is None:  # pragma: no cover - fallback for test environments
    class Celery:  # type: ignore[too-many-ancestors]
        """Lightweight stand-in used when Celery is unavailable."""

        def __init__(self, *args, **kwargs) -> None:  # noqa: D401 - simple stub
            self.tasks = {}

@celery_app.task
def orchestrate_document(data: dict) -> dict:
    pipeline = build_pipeline()
    document_in = DocumentIn(**data)
    report = pipeline.run(document_in)
    return model_dump(report)
