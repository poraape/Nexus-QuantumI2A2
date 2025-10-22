import sys
import types
import uuid
from enum import Enum


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

import importlib

backend_app_pkg = importlib.import_module("backend.app")
setattr(backend_app_pkg, "models", models_stub)
setattr(backend_app_pkg, "progress", progress_stub)

from ..ocr import AgentStatus, run_ocr


def test_run_ocr_updates_progress(monkeypatch):
    calls = []

    def fake_update_agent(job_id, agent, status, *, step=None, current=None, total=None, extra=None):
        calls.append(
            {
                "job_id": job_id,
                "agent": agent,
                "status": status,
                "step": step,
                "current": current,
                "total": total,
                "extra": extra,
            }
        )

    monkeypatch.setattr("backend.app.tasks.ocr.update_agent", fake_update_agent)
    monkeypatch.setattr("backend.app.tasks.ocr._simulate_work", lambda: None)

    job_id = uuid.uuid4()
    files = [
        {"filename": "file-1.pdf"},
        {"filename": "file-2.pdf"},
    ]
    context = {"job_id": str(job_id), "files": files}

    result = run_ocr(context)

    assert result["documents"] == [
        {"name": "file-1.pdf", "status": "OK", "data": []},
        {"name": "file-2.pdf", "status": "OK", "data": []},
    ]

    assert len(calls) == 4

    assert calls[0] == {
        "job_id": job_id,
        "agent": "ocr",
        "status": AgentStatus.RUNNING,
        "step": "Processando arquivos",
        "current": None,
        "total": None,
        "extra": None,
    }

    for index, call in enumerate(calls[1:3], start=1):
        assert call == {
            "job_id": job_id,
            "agent": "ocr",
            "status": AgentStatus.RUNNING,
            "step": "Processando arquivos",
            "current": index,
            "total": len(files),
            "extra": None,
        }

    assert calls[-1] == {
        "job_id": job_id,
        "agent": "ocr",
        "status": AgentStatus.COMPLETED,
        "step": None,
        "current": None,
        "total": None,
        "extra": {"documents": len(files)},
    }
