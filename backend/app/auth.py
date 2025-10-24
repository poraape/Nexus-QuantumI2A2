from __future__ import annotations

import hashlib
import secrets
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import Depends, Header, HTTPException, Request, Response, status
from jose import JWTError, jwt
from passlib.context import CryptContext

from .config import get_settings
from .services.audit import AuditLogger
from .services.crypto import EncryptedJsonStore

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

class UserManager:
    def __init__(self, data_path: Path):
        self.data_path = data_path
        self.data_path.parent.mkdir(parents=True, exist_ok=True)
        if not self.data_path.exists():
            self.data_path.write_text("{}", encoding="utf-8")

    def get_user(self, username: str) -> Optional[Dict[str, str]]:
        data = self._read()
        return data.get(username)

    def create_user(self, username: str, password: str) -> bool:
        data = self._read()
        if username in data:
            return False
        data[username] = {"password": pwd_context.hash(password)}
        self._write(data)
        return True

    def _write(self, data: Dict[str, Dict[str, str]]) -> None:
        import json

        self.data_path.write_text(json.dumps(data, sort_keys=True), encoding="utf-8")

    def verify_user(self, username: str, password: str) -> bool:
        record = self.get_user(username)
        if not record:
            return False
        return pwd_context.verify(password, record["password"])

    def _read(self) -> Dict[str, Dict[str, str]]:
        import json

        return json.loads(self.data_path.read_text(encoding="utf-8"))


class AuthorizationCodeStore:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self.path.write_text("{}", encoding="utf-8")

    def create_code(self, username: str, code_challenge: str, client_id: str) -> str:
        data = self._read()
        code = secrets.token_urlsafe(32)
        data[code] = {
            "username": username,
            "code_challenge": code_challenge,
            "client_id": client_id,
            "created_at": time.time(),
        }
        self._write(data)
        return code

    def consume_code(self, code: str) -> Optional[Dict[str, str]]:
        data = self._read()
        entry = data.pop(code, None)
        self._write(data)
        return entry

    def _read(self) -> Dict[str, Dict[str, str]]:
        import json

        return json.loads(self.path.read_text(encoding="utf-8"))

    def _write(self, data: Dict[str, Dict[str, str]]) -> None:
        import json

        self.path.write_text(json.dumps(data, sort_keys=True), encoding="utf-8")


class RefreshTokenStore:
    def __init__(self, store: EncryptedJsonStore, ttl_hours: int):
        self.store = store
        self.ttl_hours = ttl_hours

    def _cleanup(self, tokens: Dict[str, Dict[str, float]]) -> Dict[str, Dict[str, float]]:
        now = time.time()
        return {
            token: payload
            for token, payload in tokens.items()
            if payload.get("expires_at", 0) > now
        }

    def issue(self, username: str) -> str:
        tokens = self.store.read()
        tokens = self._cleanup(tokens)
        token = secrets.token_urlsafe(48)
        hashed = hashlib.sha256(token.encode("utf-8")).hexdigest()
        expires_at = time.time() + self.ttl_hours * 3600
        tokens[hashed] = {"username": username, "expires_at": expires_at}
        self.store.write(tokens)
        return token

    def consume(self, token: str) -> Optional[str]:
        tokens = self.store.read()
        tokens = self._cleanup(tokens)
        hashed = hashlib.sha256(token.encode("utf-8")).hexdigest()
        entry = tokens.get(hashed)
        if not entry:
            return None
        tokens.pop(hashed, None)
        self.store.write(tokens)
        return entry["username"]


def verify_pkce(code_challenge: str, code_verifier: str) -> bool:
    computed = hashlib.sha256(code_verifier.encode("utf-8")).digest()
    import base64

    challenge = base64.urlsafe_b64encode(computed).rstrip(b"=").decode("utf-8")
    return challenge == code_challenge


def create_access_token(subject: str, expires_minutes: int) -> str:
    settings = get_settings()
    expire = datetime.utcnow() + timedelta(minutes=expires_minutes)
    to_encode = {"sub": subject, "exp": expire}
    return jwt.encode(to_encode, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def _extract_bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, value = authorization.partition(" ")
    if scheme.lower() != "bearer" or not value:
        return None
    return value.strip()


def get_access_token(
    request: Request,
    authorization: str | None = Header(default=None, alias="Authorization"),
) -> str:
    settings = get_settings()
    token = _extract_bearer_token(authorization)
    if not token:
        token = request.cookies.get(settings.access_token_cookie_name)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciais inválidas.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return token


def get_current_user(token: str = Depends(get_access_token)) -> str:
    settings = get_settings()
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Credenciais inválidas.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
        username: str | None = payload.get("sub")
        if username is None:
            raise credentials_exception
        return username
    except JWTError as exc:  # noqa: BLE001
        raise credentials_exception from exc


class AuthService:
    def __init__(
        self,
        user_manager: UserManager,
        code_store: AuthorizationCodeStore,
        refresh_store: RefreshTokenStore,
        audit_logger: AuditLogger,
    ) -> None:
        self.user_manager = user_manager
        self.code_store = code_store
        self.refresh_store = refresh_store
        self.audit_logger = audit_logger

    def authorize(self, username: str, password: str, code_challenge: str, client_id: str) -> str:
        settings = get_settings()
        if client_id not in settings.oauth_client_ids:
            raise HTTPException(status_code=400, detail="Client ID não autorizado.")
        if not self.user_manager.verify_user(username, password):
            self.audit_logger.log("auth", "authorize.failed", {"username": username})
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenciais inválidas.")
        code = self.code_store.create_code(username, code_challenge, client_id)
        self.audit_logger.log("auth", "authorize.success", {"username": username})
        return code

    def exchange_token(self, code: str, code_verifier: str, client_id: str) -> Dict[str, str]:
        settings = get_settings()
        payload = self.code_store.consume_code(code)
        if not payload:
            raise HTTPException(status_code=400, detail="Código de autorização inválido.")
        if payload["client_id"] != client_id:
            raise HTTPException(status_code=400, detail="Client ID inválido para o código fornecido.")
        if not verify_pkce(payload["code_challenge"], code_verifier):
            raise HTTPException(status_code=400, detail="Code verifier inválido.")
        username = payload["username"]
        access_token = create_access_token(username, settings.jwt_expires_minutes)
        refresh_token = self.refresh_store.issue(username)
        self.audit_logger.log("auth", "token.issued", {"username": username})
        return {"access_token": access_token, "refresh_token": refresh_token, "token_type": "bearer"}

    def refresh(self, refresh_token: str) -> Dict[str, str]:
        settings = get_settings()
        username = self.refresh_store.consume(refresh_token)
        if not username:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token inválido.")
        access_token = create_access_token(username, settings.jwt_expires_minutes)
        new_refresh = self.refresh_store.issue(username)
        self.audit_logger.log("auth", "token.refreshed", {"username": username})
        return {"access_token": access_token, "refresh_token": new_refresh, "token_type": "bearer"}


def issue_auth_cookies(response: Response, access_token: str, refresh_token: str) -> None:
    settings = get_settings()
    common_kwargs: dict[str, Any] = {
        "httponly": True,
        "secure": settings.cookie_secure,
        "samesite": settings.cookie_samesite,
        "path": "/",
    }
    if settings.cookie_domain:
        common_kwargs["domain"] = settings.cookie_domain

    response.set_cookie(
        key=settings.access_token_cookie_name,
        value=access_token,
        max_age=settings.jwt_expires_minutes * 60,
        **common_kwargs,
    )
    response.set_cookie(
        key=settings.refresh_token_cookie_name,
        value=refresh_token,
        max_age=settings.refresh_token_ttl_hours * 3600,
        **common_kwargs,
    )
