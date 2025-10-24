"""Audit ingestion endpoints."""
from __future__ import annotations

import json
import secrets
from datetime import datetime, timezone
from functools import lru_cache
from typing import Annotated, Any, Iterator, Optional

from fastapi import APIRouter, Depends, Header, status
from pydantic import BaseModel, Field, validator
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.config import get_settings
from app.database import get_session
from app.models import AuditEvent
from app.services.audit import load_or_create_private_key, public_key_pem

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

router = APIRouter(prefix="/audit", tags=["audit"])


def _iso_to_datetime(value: str | datetime) -> datetime:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    if not isinstance(value, str):  # pragma: no cover - defensive
        raise TypeError("timestamp precisa ser string ISO8601 ou datetime")
    normalized = value.strip()
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    return datetime.fromisoformat(normalized).astimezone(timezone.utc)


class AuditLogPayload(BaseModel):
    id: str = Field(..., min_length=3, max_length=128)
    timestamp: datetime = Field(...)
    agent: str = Field(..., min_length=1, max_length=150)
    level: str = Field(..., min_length=3, max_length=16)
    message: str = Field(..., min_length=1, max_length=2000)
    metadata: Optional[dict[str, Any]] = Field(default=None)
    correlation_id: Optional[str] = Field(default=None, alias="correlationId", max_length=128)
    scope: Optional[str] = Field(default=None, max_length=100)

    @validator("timestamp", pre=True)
    def _parse_timestamp(cls, value: Any) -> datetime:
        return _iso_to_datetime(value)

    @validator("level")
    def _normalize_level(cls, value: str) -> str:
        normalized = value.upper()
        allowed = {"INFO", "WARN", "ERROR"}
        if normalized not in allowed:
            raise ValueError(f"level inválido: {value}")
        return normalized

    class Config:
        allow_population_by_field_name = True
        anystr_strip_whitespace = True


class AuditBatchRequest(BaseModel):
    events: list[AuditLogPayload]

    @validator("events")
    def _validate_events(cls, value: list[AuditLogPayload]) -> list[AuditLogPayload]:
        if not value:
            raise ValueError("events não pode ser vazio")
        return value


def _db_session() -> Iterator[Session]:
    with get_session() as session:
        yield session


SessionDep = Annotated[Session, Depends(_db_session)]
CurrentUserDep = Annotated[str, Depends(get_current_user)]
IngestTokenHeader = Annotated[Optional[str], Header(default=None, alias="X-Ingest-Token")]


@lru_cache()
def _signing_material() -> tuple[Ed25519PrivateKey, str]:
    settings = get_settings()
    private_key = load_or_create_private_key(settings.data_dir / "signing_key.pem")
    public_key = public_key_pem(private_key)
    return private_key, public_key


def _sign_payload(payload: dict[str, Any]) -> tuple[str, str]:
    private_key, public_key = _signing_material()
    serialized = json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")
    signature = private_key.sign(serialized).hex()
    return signature, public_key


@router.post("/logs", status_code=status.HTTP_201_CREATED)
def ingest_logs(
    request: AuditBatchRequest,
    _: CurrentUserDep,
    session: SessionDep,
    ingest_token: IngestTokenHeader = None,
) -> dict[str, Any]:
    minted_token = secrets.token_urlsafe(32)
    stored = 0

    for event in request.events:
        canonical_payload = {
            "id": event.id,
            "timestamp": event.timestamp.astimezone(timezone.utc).isoformat(),
            "agent": event.agent,
            "level": event.level,
            "message": event.message,
            "metadata": event.metadata or {},
            "correlationId": event.correlation_id,
            "scope": event.scope,
            "ingestToken": minted_token,
            "parentToken": ingest_token,
        }
        signature, public_key = _sign_payload(canonical_payload)
        record = AuditEvent(
            source_id=event.id,
            agent=event.agent,
            level=event.level,
            message=event.message,
            metadata=event.metadata,
            correlation_id=event.correlation_id,
            scope=event.scope,
            event_timestamp=event.timestamp,
            payload=canonical_payload,
            signature=signature,
            public_key=public_key,
            ingest_token=minted_token,
            parent_token=ingest_token,
        )
        session.add(record)
        stored += 1

    return {"stored": stored, "ingestToken": minted_token}
