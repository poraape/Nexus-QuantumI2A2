"""Session management for SPA access tokens."""
from __future__ import annotations

import base64
import hashlib
import secrets
import time
from dataclasses import dataclass
from threading import Lock
from typing import Dict, Optional

from fastapi import HTTPException, status

from ..auth import AuthService, AuthorizationCodeStore, RefreshTokenStore, UserManager
from ..config import get_settings
from ..services.audit import AuditLogger
from ..services.crypto import EncryptedJsonStore, KMSClient
from ..services.storage import SecureBucketClient


@dataclass
class SessionState:
    """Represents the cached state for a SPA session."""

    access_token: str
    refresh_token: str
    expires_at: float

    def as_dict(self) -> Dict[str, float | str]:
        return {
            'access_token': self.access_token,
            'refresh_token': self.refresh_token,
            'expires_at': self.expires_at,
        }


class SpaSessionManager:
    """Handles server-side OAuth exchange for the SPA."""

    def __init__(
        self,
        auth_service: AuthService,
        store: EncryptedJsonStore,
        username: str,
        password: str,
        client_id: str,
        token_ttl_seconds: int,
    ) -> None:
        self._auth_service = auth_service
        self._store = store
        self._username = username
        self._password = password
        self._client_id = client_id
        self._token_ttl_seconds = token_ttl_seconds
        self._lock = Lock()

    def _load_state(self) -> Optional[SessionState]:
        payload = self._store.read()
        if not payload:
            return None
        try:
            return SessionState(
                access_token=payload['access_token'],
                refresh_token=payload['refresh_token'],
                expires_at=float(payload['expires_at']),
            )
        except KeyError:
            return None

    def _persist_state(self, state: SessionState) -> None:
        self._store.write(state.as_dict())

    def _is_valid(self, state: SessionState | None) -> bool:
        if not state:
            return False
        return (state.expires_at - 30.0) > time.time()

    def _code_challenge(self, verifier: str) -> str:
        digest = hashlib.sha256(verifier.encode('utf-8')).digest()
        return base64.urlsafe_b64encode(digest).rstrip(b'=').decode('utf-8')

    def _perform_login(self) -> SessionState:
        code_verifier = secrets.token_urlsafe(64)
        code_challenge = self._code_challenge(code_verifier)
        code = self._auth_service.authorize(
            self._username,
            self._password,
            code_challenge,
            self._client_id,
        )
        tokens = self._auth_service.exchange_token(code, code_verifier, self._client_id)
        expires_at = time.time() + self._token_ttl_seconds
        state = SessionState(
            access_token=tokens['access_token'],
            refresh_token=tokens['refresh_token'],
            expires_at=expires_at,
        )
        self._persist_state(state)
        return state

    def _refresh(self, state: SessionState) -> Optional[SessionState]:
        try:
            tokens = self._auth_service.refresh(state.refresh_token)
        except HTTPException as exc:
            if exc.status_code == status.HTTP_401_UNAUTHORIZED:
                return None
            raise
        expires_at = time.time() + self._token_ttl_seconds
        new_state = SessionState(
            access_token=tokens['access_token'],
            refresh_token=tokens['refresh_token'],
            expires_at=expires_at,
        )
        self._persist_state(new_state)
        return new_state

    def get_session(self) -> SessionState:
        """Return a valid session, refreshing or logging in when required."""

        with self._lock:
            state = self._load_state()
            if state and self._is_valid(state):
                return state

            if state:
                refreshed = self._refresh(state)
                if refreshed and self._is_valid(refreshed):
                    return refreshed

            return self._perform_login()


def _build_auth_service() -> AuthService:
    settings = get_settings()
    kms = KMSClient(settings.kms_master_key)
    refresh_store = RefreshTokenStore(
        EncryptedJsonStore(
            settings.data_dir / settings.refresh_token_store,
            kms,
            'refresh-tokens',
        ),
        ttl_hours=settings.refresh_token_ttl_hours,
    )
    code_store = AuthorizationCodeStore(settings.data_dir / settings.authorization_code_store)
    bucket = SecureBucketClient(
        bucket_name=settings.bucket_name,
        endpoint_url=settings.bucket_endpoint_url,
        region=settings.bucket_region,
        access_key=settings.bucket_access_key,
        secret_key=settings.bucket_secret_key,
    )
    audit_logger = AuditLogger(
        log_path=settings.data_dir / settings.audit_log_name,
        bucket=bucket,
        private_key_path=settings.data_dir / 'signing_key.pem',
    )
    user_manager = UserManager(settings.data_dir / 'users.json')
    if settings.default_username and settings.default_password:
        user_manager.create_user(settings.default_username, settings.default_password)
    return AuthService(user_manager, code_store, refresh_store, audit_logger)


def _build_session_manager() -> SpaSessionManager:
    settings = get_settings()
    global _auth_service
    if _auth_service is None:
        _auth_service = _build_auth_service()
    auth_service = _auth_service
    kms = KMSClient(settings.kms_master_key)
    store = EncryptedJsonStore(
        settings.data_dir / settings.spa_session_store,
        kms,
        'spa-session',
    )
    return SpaSessionManager(
        auth_service=auth_service,
        store=store,
        username=settings.spa_username,
        password=settings.spa_password,
        client_id=settings.spa_client_id,
        token_ttl_seconds=settings.jwt_expires_minutes * 60,
    )


_session_manager: SpaSessionManager | None = None
_auth_service: AuthService | None = None


def get_session_manager() -> SpaSessionManager:
    """Return a singleton instance of the session manager."""

    global _session_manager
    if _session_manager is None:
        _session_manager = _build_session_manager()
    return _session_manager


def reset_session_manager() -> None:
    """Reset cached dependencies (used by tests)."""

    global _session_manager, _auth_service
    _session_manager = None
    _auth_service = None
