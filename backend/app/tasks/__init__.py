"""Tarefas Celery stubs."""
from __future__ import annotations

from celery import Celery

from app.orchestrator.state_machine import build_pipeline
from app.schemas import DocumentIn

celery_app = Celery("nexus", broker="redis://localhost:6379/0")


@celery_app.task
def orchestrate_document(data: dict) -> dict:
    pipeline = build_pipeline()
    document_in = DocumentIn(**data)
    report = pipeline.run(document_in)
    return report.model_dump()
