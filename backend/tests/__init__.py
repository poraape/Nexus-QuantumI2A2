"""Test package helpers and environment bootstrapping."""
from __future__ import annotations

import base64
import importlib
import os
import sys
import types

os.environ.setdefault("JWT_SECRET_KEY", "test-secret")
os.environ.setdefault("SPA_AUTH_USERNAME", "test-user")
os.environ.setdefault("SPA_AUTH_PASSWORD", "test-pass")
os.environ.setdefault("KMS_MASTER_KEY", base64.urlsafe_b64encode(b"0" * 32).decode("utf-8"))

if "tenacity" not in sys.modules:
    tenacity_stub = types.ModuleType("tenacity")

    def _retry(*_args, **_kwargs):
        def decorator(func):
            return func

        return decorator

    tenacity_stub.retry = _retry  # type: ignore[attr-defined]
    tenacity_stub.stop_after_attempt = lambda *args, **kwargs: None  # type: ignore[attr-defined]
    tenacity_stub.wait_exponential_jitter = lambda *args, **kwargs: None  # type: ignore[attr-defined]
    sys.modules["tenacity"] = tenacity_stub

if "celery" not in sys.modules:
    celery_stub = types.ModuleType("celery")

    def _shared_task(*_args, **_kwargs):
        def decorator(func):
            return func

        return decorator

    class Celery:  # pragma: no cover - simplified stub
        def __init__(self, *_args, **_kwargs):
            pass

        def task(self, func=None, **_kwargs):
            if func is None:
                return lambda f: f
            return func

    celery_stub.Celery = Celery
    celery_stub.shared_task = _shared_task
    sys.modules["celery"] = celery_stub

# Ensure the backend package is imported so ``app`` aliases são registrados,
# a menos que explicitamente desativado (útil para testes focados).
if os.environ.get("BACKEND_TEST_SKIP_BOOTSTRAP") != "1":  # pragma: no cover - comportamento padrão
    import backend.app  # noqa: F401
