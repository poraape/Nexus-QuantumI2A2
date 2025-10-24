"""Database models for orchestration state."""
from __future__ import annotations

import uuid
from copy import deepcopy
from datetime import datetime
from enum import Enum
from typing import Dict, Optional

from sqlalchemy import JSON, DateTime, String
from sqlalchemy import Enum as SqlEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


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


DEFAULT_AGENT_STATES: Dict[str, Dict[str, object]] = {
    "ocr": {"status": AgentStatus.PENDING.value, "progress": {"step": "Aguardando arquivos", "current": 0, "total": 0}},
    "auditor": {"status": AgentStatus.PENDING.value, "progress": {}},
    "classifier": {"status": AgentStatus.PENDING.value, "progress": {}},
    "intelligence": {"status": AgentStatus.PENDING.value, "progress": {}},
    "accountant": {"status": AgentStatus.PENDING.value, "progress": {}},
    "crossValidator": {"status": AgentStatus.PENDING.value, "progress": {}},
}


class AnalysisJob(Base):
    """Persisted workflow state for an analysis."""

    __tablename__ = "analysis_jobs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    status: Mapped[JobStatus] = mapped_column(SqlEnum(JobStatus), default=JobStatus.QUEUED, nullable=False)
    agent_states: Mapped[Dict[str, Dict[str, object]]] = mapped_column(JSON, default=lambda: deepcopy(DEFAULT_AGENT_STATES))
    webhook_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(String(2000), nullable=True)
    result_payload: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)


class StoredFile(Base):
    """Metadata for uploaded files saved to disk."""

    __tablename__ = "stored_files"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    job_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    path: Mapped[str] = mapped_column(String(1000), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
