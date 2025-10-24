"""Schemas and payload contracts for orchestrator messaging."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, Generic, List, Literal, Mapping, Optional, TypeVar

MessageKind = Literal["raw", "summary", "insight"]


@dataclass(slots=True)
class RawDataPayload:
    """Represents low-level information materialized during extraction."""

    document_id: str
    stage: str
    data: Mapping[str, Any]
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        payload = {
            "documentId": self.document_id,
            "stage": self.stage,
            "data": dict(self.data),
        }
        if self.metadata:
            payload["metadata"] = dict(self.metadata)
        return payload


@dataclass(slots=True)
class SemanticSummaryPayload:
    """Captures semantic digests produced by mid-pipeline agents."""

    document_id: str
    stage: str
    summary: str
    highlights: List[str] = field(default_factory=list)
    score: Optional[float] = None
    extra: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "documentId": self.document_id,
            "stage": self.stage,
            "summary": self.summary,
        }
        if self.highlights:
            payload["highlights"] = list(self.highlights)
        if self.score is not None:
            payload["score"] = self.score
        if self.extra:
            payload["extra"] = dict(self.extra)
        return payload


@dataclass(slots=True)
class FinalInsightPayload:
    """Represents the final insight layer delivered to clients."""

    document_id: str
    stage: str
    summary: str
    insights: List[str] = field(default_factory=list)
    provenance: List[Mapping[str, Any]] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "documentId": self.document_id,
            "stage": self.stage,
            "summary": self.summary,
            "insights": list(self.insights),
        }
        if self.provenance:
            payload["provenance"] = [dict(item) for item in self.provenance]
        return payload


TPayload = TypeVar("TPayload", RawDataPayload, SemanticSummaryPayload, FinalInsightPayload)


@dataclass(slots=True)
class MessageEnvelope(Generic[TPayload]):
    """Envelope shared between agents through the blackboard."""

    agent: str
    kind: MessageKind
    payload: TPayload
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    tokens: Optional[int] = None
    latency_ms: Optional[float] = None
    correlation_id: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        data = {
            "agent": self.agent,
            "kind": self.kind,
            "payload": self.payload.to_dict(),
            "timestamp": self.timestamp.isoformat(),
        }
        if self.tokens is not None:
            data["tokens"] = self.tokens
        if self.latency_ms is not None:
            data["latencyMs"] = self.latency_ms
        if self.correlation_id:
            data["correlationId"] = self.correlation_id
        return data


@dataclass(slots=True)
class BlackboardSnapshot:
    """Serializable snapshot of the blackboard state."""

    raw_data: List[MessageEnvelope[RawDataPayload]] = field(default_factory=list)
    semantic_summaries: List[MessageEnvelope[SemanticSummaryPayload]] = field(default_factory=list)
    insights: List[MessageEnvelope[FinalInsightPayload]] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "raw": [message.to_dict() for message in self.raw_data],
            "summaries": [message.to_dict() for message in self.semantic_summaries],
            "insights": [message.to_dict() for message in self.insights],
        }


__all__ = [
    "RawDataPayload",
    "SemanticSummaryPayload",
    "FinalInsightPayload",
    "MessageEnvelope",
    "BlackboardSnapshot",
    "MessageKind",
]
