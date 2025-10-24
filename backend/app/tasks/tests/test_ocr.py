import sys
import sys
import types
import uuid


if "celery" not in sys.modules:
    celery_stub = types.ModuleType("celery")

    def _shared_task(*_args, **_kwargs):
        def decorator(func):
            return func

        return decorator

    celery_stub.shared_task = _shared_task
    sys.modules["celery"] = celery_stub


def test_run_ocr_returns_insight(monkeypatch):
    from ..ocr import run_ocr

    job_id = uuid.uuid4()
    payload = {"job_id": str(job_id), "document": {"document_id": "doc-1"}}
    insight = {"document_id": "doc-1", "title": "Resumo", "summary": "ok"}

    calls = []

    def fake_update_agent(job, agent, status, *, step=None, current=None, total=None, extra=None):
        calls.append(
            {
                "job_id": job,
                "agent": agent,
                "status": status,
                "step": step,
                "extra": extra,
            }
        )

    monkeypatch.setattr("backend.app.tasks.ocr.update_agent", fake_update_agent)
    monkeypatch.setattr("backend.app.tasks.ocr.execute_pipeline", lambda *args, **kwargs: object())
    monkeypatch.setattr(
        "backend.app.tasks.ocr.serialize_pipeline_result",
        lambda _result: {"insight": insight},
    )

    result = run_ocr(payload)

    assert result == insight
    assert payload["pipeline_result"]["insight"] == insight

    assert calls[0]["agent"] == "ocr"
    assert calls[0]["status"].name == "RUNNING"
    assert calls[-1]["status"].name == "COMPLETED"
