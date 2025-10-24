import base64
import importlib
from typing import Callable

from fastapi import FastAPI
from fastapi.testclient import TestClient

# Ensure Celery decorators are no-ops during the test run.
import sys
import types

if "celery" not in sys.modules:
    celery_stub = types.ModuleType("celery")

    def _shared_task(*_args, **_kwargs):
        def decorator(func: Callable):
            return func

        return decorator

    celery_stub.shared_task = _shared_task
    sys.modules["celery"] = celery_stub


def test_analysis_contract_processes_xml(tmp_path, monkeypatch):
    database_url = f"sqlite:///{tmp_path/'app.db'}"
    storage_path = tmp_path / "storage"
    data_dir = tmp_path / "data"

    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.setenv("BACKEND_DATA_DIR", str(data_dir))
    monkeypatch.setenv("STORAGE_PATH", str(storage_path))
    monkeypatch.setenv("JWT_SECRET_KEY", "contract-secret")
    monkeypatch.setenv("JWT_EXPIRES_MINUTES", "30")
    monkeypatch.setenv("REFRESH_TOKEN_TTL_HOURS", "24")
    monkeypatch.setenv("SPA_AUTH_USERNAME", "tester")
    monkeypatch.setenv("SPA_AUTH_PASSWORD", "tester-pass")
    monkeypatch.setenv("SPA_AUTH_CLIENT_ID", "test-client")
    monkeypatch.setenv("OAUTH_CLIENT_IDS", '["test-client"]')
    monkeypatch.setenv("COOKIE_SECURE", "false")
    monkeypatch.setenv("KMS_MASTER_KEY", base64.urlsafe_b64encode(b"0" * 32).decode("utf-8"))

    for module_name in [
        "backend.app.database",
        "backend.app.storage",
        "backend.app.progress",
        "backend.app.orchestrator",
        "backend.app.services.persistence",
    ]:
        if module_name in sys.modules:
            importlib.reload(sys.modules[module_name])
        else:
            importlib.import_module(module_name)

    from backend.app import config as config_module

    config_module.get_settings.cache_clear()
    settings = config_module.get_settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    settings.storage_path.mkdir(parents=True, exist_ok=True)

    from backend.app import database as database_module

    if hasattr(database_module.Base, "metadata") and database_module.engine is not None:
        database_module.Base.metadata.create_all(database_module.engine)

    from backend.app import api as analysis_module
    get_current_user = analysis_module.get_current_user
    analysis_router = analysis_module.router
    from backend.app.tasks import pipeline as pipeline_tasks

    def _immediate_apply_async(*, args=(), kwargs=None):
        pipeline_tasks.run_pipeline(*(args or ()), **(kwargs or {}))

        class _Result:
            def get(self, disable_sync_subtasks: bool = False):
                return None

        return _Result()

    monkeypatch.setattr(
        pipeline_tasks.run_pipeline, "apply_async", _immediate_apply_async, raising=False
    )

    app = FastAPI()
    app.include_router(analysis_router)
    app.dependency_overrides[get_current_user] = lambda: "contract-user"

    client = TestClient(app)

    xml_content = """<?xml version='1.0' encoding='UTF-8'?>
<nfeProc>
  <NFe>
    <infNFe>
      <det nItem='1'>
        <prod>
          <cProd>27101932</cProd>
          <xProd>Diesel B S10</xProd>
          <qCom>2.0</qCom>
          <vUnCom>150.00</vUnCom>
          <vProd>300.00</vProd>
        </prod>
      </det>
    </infNFe>
  </NFe>
</nfeProc>
"""
    xml_path = tmp_path / "nota.xml"
    xml_path.write_text(xml_content, encoding="utf-8")

    with xml_path.open("rb") as handle:
        response = client.post(
            "/api/analysis",
            files=[("files", ("nota.xml", handle, "application/xml"))],
        )

    assert response.status_code == 200
    job_payload = response.json()
    job_id = job_payload["jobId"]

    result_response = client.get(f"/api/analysis/{job_id}")
    assert result_response.status_code == 200
    analysis = result_response.json()
    assert analysis["status"] == "completed"
    documents = analysis["result"]["documents"]
    assert documents
    assert documents[0]["totals"]["grand_total"] > 0
