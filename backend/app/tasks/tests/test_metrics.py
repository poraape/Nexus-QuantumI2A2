"""Telemetry emission tests for agent tasks."""
from __future__ import annotations

import importlib
import sys
import types
import uuid
from enum import Enum
from typing import Any, Dict, List

import pytest

from ...telemetry import telemetry

if "celery" not in sys.modules:
    celery_stub = types.ModuleType("celery")

    def _shared_task(*args, **kwargs):
        def decorator(func):
            return func

        return decorator

    celery_stub.shared_task = _shared_task
    sys.modules["celery"] = celery_stub

if "backend.app.models" not in sys.modules:
    models_stub = types.ModuleType("backend.app.models")

    class JobStatus(str, Enum):
        QUEUED = "queued"
        RUNNING = "running"
        COMPLETED = "completed"
        FAILED = "failed"

    class AgentStatus(str, Enum):
        PENDING = "pending"
        RUNNING = "running"
        COMPLETED = "completed"
        ERROR = "error"

    models_stub.JobStatus = JobStatus
    models_stub.AgentStatus = AgentStatus
    sys.modules["backend.app.models"] = models_stub
else:
    models_stub = sys.modules["backend.app.models"]

if "backend.app.progress" not in sys.modules:
    progress_stub = types.ModuleType("backend.app.progress")

    def _update_agent_stub(*args, **kwargs):  # pragma: no cover - placeholder
        pass

    def _set_job_result_stub(*args, **kwargs):  # pragma: no cover - placeholder
        pass

    progress_stub.update_agent = _update_agent_stub
    progress_stub.set_job_result = _set_job_result_stub
    sys.modules["backend.app.progress"] = progress_stub
else:
    progress_stub = sys.modules["backend.app.progress"]

backend_app_pkg = importlib.import_module("backend.app")
backend_app_pkg.models = models_stub
backend_app_pkg.progress = progress_stub


@pytest.mark.parametrize("file_count", [4])
def test_agent_tasks_emit_metrics(monkeypatch, tmp_path, file_count):
    from .. import accountant, auditor, classifier, cross_validator, intelligence, ocr

    records: Dict[str, List[Dict[str, Any]]] = {
        "latency": [],
        "success": [],
        "error": [],
        "inconsistency": [],
    }

    def capture_latency(agent: str, operation: str, duration_ms: float, attributes: Dict[str, Any] | None = None) -> None:
        records["latency"].append(
            {
                "agent": agent,
                "operation": operation,
                "duration": duration_ms,
                "attributes": dict(attributes or {}),
            }
        )

    def capture_success(agent: str, operation: str, attributes: Dict[str, Any] | None = None) -> None:
        records["success"].append(
            {"agent": agent, "operation": operation, "attributes": dict(attributes or {})}
        )

    def capture_error(agent: str, operation: str, attributes: Dict[str, Any] | None = None) -> None:
        records["error"].append(
            {"agent": agent, "operation": operation, "attributes": dict(attributes or {})}
        )

    def capture_inconsistency(
        agent: str, operation: str, count: int, attributes: Dict[str, Any] | None = None
    ) -> None:
        records["inconsistency"].append(
            {
                "agent": agent,
                "operation": operation,
                "count": count,
                "attributes": dict(attributes or {}),
            }
        )

    monkeypatch.setattr(telemetry, "record_latency", capture_latency)
    monkeypatch.setattr(telemetry, "record_success", capture_success)
    monkeypatch.setattr(telemetry, "record_error", capture_error)
    monkeypatch.setattr(telemetry, "record_inconsistency", capture_inconsistency)

    job_id = uuid.uuid4()
    files: List[Dict[str, Any]] = []
    for index in range(file_count):
        file_path = tmp_path / f"invoice-{index + 1}.txt"
        file_path.write_text(
            f"SKU{index + 1} Produto {index + 1} 1 R$ 10,00 R$ 10,00\nSKU{index + 10} Bonus 1 R$ 5,00 R$ 5,00"
        )
        files.append({"filename": f"invoice-{index + 1}.pdf", "path": str(file_path)})

    context: Dict[str, Any] = {"job_id": str(job_id), "files": files}
    context = ocr.run_ocr(context)
    context = auditor.run_auditor(context)
    context = classifier.run_classifier(context)
    context = cross_validator.run_cross_validator(context)
    context = intelligence.run_intelligence(context)
    context = accountant.run_accountant(context)

    tracked_agents = {"ocr", "auditor", "classifier", "crossValidator", "intelligence", "accountant"}

    assert tracked_agents.issubset({entry["agent"] for entry in records["latency"]})
    assert tracked_agents.issubset({entry["agent"] for entry in records["success"]})
    assert records["error"] == []

    inconsistencies = [entry for entry in records["inconsistency"] if entry["agent"] == "crossValidator"]
    assert inconsistencies, "Esperado ao menos um registro de inconsistências"
    assert inconsistencies[0]["count"] > 0

    for latency_entry in records["latency"]:
        assert latency_entry["duration"] >= 0
