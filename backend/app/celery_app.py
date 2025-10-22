"""Celery application factory."""
from __future__ import annotations

from celery import Celery

from .config import settings


celery_app = Celery(
    "nexus_quantum",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=[
        "backend.app.tasks.ocr",
        "backend.app.tasks.auditor",
        "backend.app.tasks.classifier",
        "backend.app.tasks.cross_validator",
        "backend.app.tasks.intelligence",
        "backend.app.tasks.accountant",
        "backend.app.tasks.pipeline",
    ],
)

celery_app.conf.update(task_track_started=True, result_expires=3600)
