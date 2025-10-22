from __future__ import annotations

import base64
import os
from pathlib import Path
from typing import Dict

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.api import router as api_router
from backend.app.auth import UserManager
from backend.app.config import get_settings
from backend.app.services.crypto import EncryptedJsonStore, KMSClient
from backend.app.services.session import reset_session_manager


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
        'OAUTH_CLIENT_IDS': 'nexus-spa',
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
    user_manager = UserManager(settings.data_dir / 'users.json')
    user_manager.create_user(settings.spa_username, user_password)

    app = FastAPI()
    app.include_router(api_router)
    return TestClient(app)


def test_session_endpoint_returns_access_token_and_persists_refresh_token(tmp_path):
    client = _prepare_app(tmp_path)

    response = client.post('/api/session')
    assert response.status_code == 200
    payload = response.json()
    assert 'accessToken' in payload
    assert 'expiresAt' in payload
    assert 'refreshToken' not in payload

    settings = get_settings()
    store_path = settings.data_dir / settings.spa_session_store
    assert store_path.exists()

    raw_content = store_path.read_text(encoding='utf-8')
    assert 'refresh_token' not in raw_content

    store = EncryptedJsonStore(store_path, KMSClient(settings.kms_master_key), 'spa-session')
    decrypted = store.read()
    assert 'refresh_token' in decrypted
    assert isinstance(decrypted['refresh_token'], str)


def test_session_endpoint_requires_valid_backend_credentials(tmp_path):
    overrides = {'SPA_AUTH_PASSWORD': 'wrong-pass'}
    client = _prepare_app(tmp_path, overrides=overrides, user_password='spa-pass')

    response = client.post('/api/session')
    assert response.status_code == 401
