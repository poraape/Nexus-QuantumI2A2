"""Common utilities shared between Celery tasks."""
from __future__ import annotations

import uuid
from typing import Any, Dict, List

from ..models import AgentStatus, JobStatus
from ..orchestrator.state_machine import PipelineOrchestrator, PipelineRunResult
from ..progress import set_job_result, update_agent
from ..schemas import DocumentIn
from ..utils import model_dump


def execute_pipeline(job_id: uuid.UUID, document_data: Dict[str, Any]) -> PipelineRunResult:
    """Run the synchronous pipeline orchestrator for a given document payload."""

    orchestrator = PipelineOrchestrator()
    document = DocumentIn(**document_data)
    return orchestrator.run(document)


def serialize_pipeline_result(result: PipelineRunResult) -> Dict[str, Any]:
    """Serialize pipeline artifacts into plain dictionaries for transport."""

    return {
        "document": model_dump(result.document),
        "audit": model_dump(result.audit),
        "classification": model_dump(result.classification),
        "accounting": model_dump(result.accounting),
        "insight": model_dump(result.insight),
    }


def ensure_pipeline_result(job_id: uuid.UUID, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Return a serialized pipeline result, computing it if necessary."""

    existing = payload.get("pipeline_result")
    if isinstance(existing, dict):
        return existing

    document_data = payload.get("document")
    if not isinstance(document_data, dict):
        raise ValueError("Document payload ausente para execução do pipeline")

    result = execute_pipeline(job_id, document_data)
    serialized = serialize_pipeline_result(result)
    payload["pipeline_result"] = serialized
    return serialized


def build_operations_from_pipeline(pipeline_result: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Derive ICMS operations from the extracted document."""

    operations: List[Dict[str, Any]] = []
    document: Dict[str, Any] = pipeline_result.get("document", {})  # type: ignore[assignment]
    items: List[Dict[str, Any]] = document.get("items", [])  # type: ignore[assignment]
    if not items:
        return operations

    metadata = document.get("metadata", {}) if isinstance(document.get("metadata"), dict) else {}
    destino = (
        metadata.get("destino_uf")
        or metadata.get("destinatario_uf")
        or metadata.get("uf_destino")
        or "SP"
    )
    for index, item in enumerate(items, start=1):
        value = float(item.get("total_value", 0.0) or 0.0)
        if value <= 0:
            continue
        operations.append(
            {
                "id": f"{document.get('document_id', 'doc')}-item-{index}",
                "document": document.get("filename"),
                "uf": destino,
                "ncm": (item.get("sku") or "00000000"),
                "value": value,
            }
        )
    return operations


def update_agent_running(job_id: uuid.UUID, agent: str, step: str) -> None:
    update_agent(job_id, agent, AgentStatus.RUNNING, step=step)


def update_agent_completed(job_id: uuid.UUID, agent: str, extra: Dict[str, Any] | None = None) -> None:
    update_agent(job_id, agent, AgentStatus.COMPLETED, extra=extra)


def mark_failed(job_id: uuid.UUID, agent: str, error: Exception) -> None:
    update_agent(job_id, agent, AgentStatus.ERROR, extra={"error": str(error)})
    set_job_result(job_id, status=JobStatus.FAILED, error_message=str(error))
