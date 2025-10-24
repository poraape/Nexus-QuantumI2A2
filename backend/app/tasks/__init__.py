"""Tarefas Celery stubs."""
from __future__ import annotations

import importlib.util

celery_spec = importlib.util.find_spec("celery")

if celery_spec is None:  # pragma: no cover - fallback for test environments
    class Celery:  # type: ignore[too-many-ancestors]
        """Lightweight stand-in used when Celery is unavailable."""

        def __init__(self, *args, **kwargs) -> None:  # noqa: D401 - simple stub
            self.tasks = {}

        def task(self, func=None, **kwargs):  # type: ignore[no-untyped-def]
            def decorator(fn):
                self.tasks[fn.__name__] = fn
                return fn

            if func is not None:
                return decorator(func)
            return decorator

    celery_app = Celery("nexus", broker="redis://localhost:6379/0")

    def orchestrate_document(data: dict) -> dict:  # type: ignore[unused-argument]
        raise RuntimeError("Celery orchestration indisponível sem dependências de app")

else:  # pragma: no cover - exercised in integration environments
    from celery import Celery

    celery_app = Celery("nexus", broker="redis://localhost:6379/0")

    from ..orchestrator.state_machine import build_pipeline
    from ..schemas import DocumentIn

    @celery_app.task
    def orchestrate_document(data: dict) -> dict:
        pipeline = build_pipeline()
        document_in = DocumentIn(**data)
        report = pipeline.run(document_in)
        return report.model_dump()
