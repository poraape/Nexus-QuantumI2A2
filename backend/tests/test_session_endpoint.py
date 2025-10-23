from __future__ import annotations

import base64
import os
import sys
import types
from pathlib import Path
from typing import Dict

import backend.app as backend_app_package

sys.modules.setdefault('app', backend_app_package)

tenacity_stub = types.ModuleType('tenacity')


def _retry_stub(*_args, **_kwargs):  # pragma: no cover - placeholder decorator
    def _decorator(func):
        return func

    return _decorator


tenacity_stub.retry = _retry_stub  # type: ignore[attr-defined]
tenacity_stub.stop_after_attempt = lambda *args, **kwargs: None  # type: ignore[attr-defined]
tenacity_stub.wait_exponential_jitter = lambda *args, **kwargs: None  # type: ignore[attr-defined]
sys.modules.setdefault('tenacity', tenacity_stub)

from fastapi import Depends, FastAPI, Response
from fastapi.testclient import TestClient

from backend.app.auth import UserManager, issue_auth_cookies
from backend.app.config import get_settings
from backend.app.services.crypto import EncryptedJsonStore, KMSClient
from backend.app.services.session import SpaSessionManager, get_session_manager, reset_session_manager


def _base_env(tmp_path: Path, overrides: Dict[str, str] | None = None) -> Dict[str, str]:
    key = base64.urlsafe_b64encode(b'0' * 32).decode('utf-8')
    env_values: Dict[str, str] = {
        'BACKEND_DATA_DIR': str(tmp_path),
        'JWT_SECRET_KEY': 'test-secret',
        'JWT_EXPIRES_MINUTES': '5',
        'KMS_MASTER_KEY': key,
        'SPA_AUTH_USERNAME': 'spa-user',
        'SPA_AUTH_PASSWORD': 'spa-pass',
        'SPA_AUTH_CLIENT_ID': 'nexus-spa',
        'OAUTH_CLIENT_IDS': '["nexus-spa"]',
        'COOKIE_SECURE': 'false',
    }
    if overrides:
        env_values.update(overrides)

    for key_name, value in env_values.items():
        if value is None:
            continue
        os.environ[key_name] = value

    return env_values


def _prepare_app(
    tmp_path: Path,
    overrides: Dict[str, str] | None = None,
    user_password: str = 'spa-pass',
) -> TestClient:
    reset_session_manager()

    _base_env(tmp_path, overrides=overrides)

    # Refresh cached settings after updating environment.
    from backend.app import config as config_module

    config_module.get_settings.cache_clear()
    settings = get_settings()

    # Ensure SPA service user exists for tests.
    from backend.app import auth as auth_module

    auth_module.pwd_context.hash = lambda password: password  # type: ignore[assignment]
    auth_module.pwd_context.verify = lambda provided, stored: provided == stored  # type: ignore[assignment]
    user_manager = UserManager(settings.data_dir / 'users.json')
    user_manager.create_user(settings.spa_username, user_password)

    app = FastAPI()

    @app.post('/api/session')
    async def create_session(
        response: Response,
        session_manager: SpaSessionManager = Depends(get_session_manager),
    ) -> Dict[str, int]:
        state = session_manager.get_session()
        issue_auth_cookies(response, state.access_token, state.refresh_token)
        return {
            'expiresAt': int(state.expires_at * 1000),
        }

    return TestClient(app)


def test_session_endpoint_sets_secure_cookies_and_persists_refresh_token(tmp_path):
    client = _prepare_app(tmp_path)

    response = client.post('/api/session')
    assert response.status_code == 200
    payload = response.json()
    assert 'expiresAt' in payload
    assert 'accessToken' not in payload

    settings = get_settings()
    store_path = settings.data_dir / settings.spa_session_store
    assert store_path.exists()

    raw_content = store_path.read_text(encoding='utf-8')
    assert 'refresh_token' not in raw_content

    store = EncryptedJsonStore(store_path, KMSClient(settings.kms_master_key), 'spa-session')
    decrypted = store.read()
    assert 'refresh_token' in decrypted
    assert isinstance(decrypted['refresh_token'], str)

    access_cookie = response.cookies.get(settings.access_token_cookie_name)
    refresh_cookie = response.cookies.get(settings.refresh_token_cookie_name)
    assert access_cookie
    assert refresh_cookie


def test_session_endpoint_requires_valid_backend_credentials(tmp_path):
    overrides = {'SPA_AUTH_PASSWORD': 'wrong-pass'}
    client = _prepare_app(tmp_path, overrides=overrides, user_password='spa-pass')

    response = client.post('/api/session')
    assert response.status_code == 401
