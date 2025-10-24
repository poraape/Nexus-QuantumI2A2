from __future__ import annotations

import base64
import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

import types

tenacity_stub = types.ModuleType("tenacity")


def _retry_stub(*_args, **_kwargs):  # pragma: no cover - placeholder decorator
    def _decorator(func):
        return func

    return _decorator


tenacity_stub.retry = _retry_stub  # type: ignore[attr-defined]
tenacity_stub.stop_after_attempt = lambda *args, **kwargs: None  # type: ignore[attr-defined]
tenacity_stub.wait_exponential_jitter = lambda *args, **kwargs: None  # type: ignore[attr-defined]
sys.modules.setdefault("tenacity", tenacity_stub)

import app as app_package
import app.schemas  # noqa: F401
import app.services  # noqa: F401
import app.services.accounting_service as accounting_service_module  # noqa: F401
import app.services.audit as audit_service_module  # noqa: F401
import app.services.llm_service as llm_service_module  # noqa: F401
import app.services.nlp_service as nlp_service_module  # noqa: F401
import app.services.ocr_service as ocr_service_module  # noqa: F401
import app.services.storage_service as storage_service_module  # noqa: F401

sys.modules.setdefault("app", app_package)
sys.modules.setdefault("app.services", sys.modules["app.services"])
sys.modules.setdefault("app.services.audit", audit_service_module)
sys.modules.setdefault("app.schemas", sys.modules["app.schemas"])
sys.modules.setdefault("app.services.accounting_service", accounting_service_module)
sys.modules.setdefault("app.services.llm_service", llm_service_module)
sys.modules.setdefault("app.services.nlp_service", nlp_service_module)
sys.modules.setdefault("app.services.ocr_service", ocr_service_module)
sys.modules.setdefault("app.services.storage_service", storage_service_module)

from backend.app.auth import create_access_token


@pytest.fixture()
def audit_test_client(tmp_path: Path) -> TestClient:
    key = base64.urlsafe_b64encode(b"0" * 32).decode("utf-8")
    env_overrides = {
        "DATABASE_URL": f"sqlite:///{tmp_path/'audit.db'}",
        "BACKEND_DATA_DIR": str(tmp_path / "data"),
        "JWT_SECRET_KEY": "test-secret",
        "JWT_EXPIRES_MINUTES": "5",
        "SPA_AUTH_USERNAME": "spa-user",
        "SPA_AUTH_PASSWORD": "spa-pass",
        "KMS_MASTER_KEY": key,
        "COOKIE_SECURE": "false",
    }
    for key_name, value in env_overrides.items():
        os.environ[key_name] = value

    from backend.app import config as config_module

    config_module.get_settings.cache_clear()

    import importlib
    from backend.app import database as database_module

    importlib.reload(database_module)
    database_module.Base.metadata.create_all(bind=database_module.engine)

    import backend.app.api.main as api_main

    importlib.reload(api_main)
    app = api_main.create_app()
    return TestClient(app)


def test_audit_log_batch_persists_and_signs(audit_test_client: TestClient) -> None:
    token = create_access_token("spa-user", expires_minutes=5)

    payload = {
        "events": [
            {
                "id": "event-1",
                "timestamp": "2024-01-01T10:00:00Z",
                "agent": "frontend",
                "level": "info",
                "message": "Pipeline iniciado",
                "metadata": {"correlationId": "abc"},
                "correlationId": "abc",
                "scope": "agent",
            }
        ]
    }

    response = audit_test_client.post(
        "/api/audit/logs",
        headers={"Authorization": f"Bearer {token}"},
        json=payload,
    )

    assert response.status_code == 201
    body = response.json()
    assert body["stored"] == 1
    assert isinstance(body["ingestToken"], str) and len(body["ingestToken"]) > 10

    from backend.app import database as database_module
    from backend.app.models import AuditEvent

    with database_module.get_session() as session:
        stored = session.query(AuditEvent).all()
        assert len(stored) == 1
        event = stored[0]
        assert event.signature
        assert event.public_key
        assert event.payload["message"] == "Pipeline iniciado"
        assert event.metadata == {"correlationId": "abc"}
        assert event.correlation_id == "abc"
        assert event.ingest_token == body["ingestToken"]
