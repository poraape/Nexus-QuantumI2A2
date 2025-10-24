"""Pipeline orchestration task executed synchronously."""
from __future__ import annotations

import asyncio
import datetime as dt
import uuid
from typing import Any, Dict, Iterable, List

from celery import shared_task

from ..models import AgentStatus, JobStatus
from ..progress import set_job_result, update_agent
from ..schemas import DocumentIn
from ..services.persistence import persist_pipeline_artifacts
from ..tax import icms_service
from ..utils import model_dump
from ..services.orchestrator.budget import TokenBudgetExceeded, TokenBudgetManager
from .base import build_operations_from_pipeline, serialize_pipeline_result
from ..orchestrator.state_machine import PipelineRunResult

from services.orchestrator.async_controller import AsyncAgentController
from services.orchestrator.schemas import (
    FinalInsightPayload,
    MessageEnvelope,
    RawDataPayload,
    SemanticSummaryPayload,
)


def _prepare_documents(job_id: uuid.UUID, files: Iterable[Dict[str, object]]) -> List[DocumentIn]:
    documents: List[DocumentIn] = []
    for index, file_info in enumerate(files, start=1):
        filename = str(file_info.get("filename") or f"documento_{index}")
        storage_path = str(file_info.get("path"))
        if not storage_path:
            raise ValueError("Arquivo enviado sem caminho de armazenamento válido")
        content_type = str(file_info.get("content_type") or "application/octet-stream")
        document_id = f"{job_id.hex}-{index:03d}"
        metadata = {
            "job_id": str(job_id),
            "source_filename": filename,
            "origem_uf": file_info.get("origem_uf", "SP"),
            "destino_uf": file_info.get("destino_uf", "SP"),
        }
        extra_metadata = file_info.get("metadata") if isinstance(file_info, dict) else {}
        if isinstance(extra_metadata, dict):
            metadata.update({key: value for key, value in extra_metadata.items() if key not in metadata})
        documents.append(
            DocumentIn(
                document_id=document_id,
                filename=filename,
                content_type=content_type,
                storage_path=storage_path,
                metadata=metadata,
            )
        )
    return documents


def _mark_agents_running(job_id: uuid.UUID, current: int, total: int) -> None:
    update_agent(job_id, "ocr", AgentStatus.RUNNING, step="Extraindo documento", current=current, total=total)
    update_agent(job_id, "auditor", AgentStatus.RUNNING, step="Validando documento", current=current, total=total)
    update_agent(job_id, "classifier", AgentStatus.RUNNING, step="Classificando documento", current=current, total=total)
    update_agent(job_id, "crossValidator", AgentStatus.RUNNING, step="Gerando operações fiscais", current=current, total=total)
    update_agent(job_id, "intelligence", AgentStatus.RUNNING, step="Gerando insights", current=current, total=total)
    update_agent(job_id, "accountant", AgentStatus.RUNNING, step="Consolidando relatório", current=current, total=total)


def _mark_agents_completed(job_id: uuid.UUID, documents: int) -> None:
    update_agent(job_id, "ocr", AgentStatus.COMPLETED, extra={"documents": documents})
    update_agent(job_id, "auditor", AgentStatus.COMPLETED, extra={"documents": documents})
    update_agent(job_id, "classifier", AgentStatus.COMPLETED, extra={"documents": documents})
    update_agent(job_id, "crossValidator", AgentStatus.COMPLETED, extra={"documents": documents})
    update_agent(job_id, "intelligence", AgentStatus.COMPLETED, extra={"documents": documents})
    update_agent(job_id, "accountant", AgentStatus.COMPLETED, extra={"documents": documents})


_STAGE_TO_AGENTS = {
    "extraction": [("ocr", "Extraindo documento")],
    "audit": [("auditor", "Validando documento")],
    "classification": [("classifier", "Classificando documento")],
    "accounting": [
        ("crossValidator", "Gerando operações fiscais"),
        ("accountant", "Consolidando relatório"),
    ],
    "insight": [("intelligence", "Gerando insights")],
}


def _build_progress_extra(message: MessageEnvelope[Any]) -> Dict[str, Any]:
    extra: Dict[str, Any] = {}
    if message.tokens is not None:
        extra["tokens"] = message.tokens
    if message.latency_ms is not None:
        extra["latencyMs"] = round(message.latency_ms, 2)

    payload = message.payload
    if isinstance(payload, RawDataPayload):
        extra["documentId"] = payload.document_id
        extra["stage"] = payload.stage
        data = dict(payload.data)
        totals = data.get("totals")
        if totals:
            extra["totals"] = totals
        if payload.metadata:
            extra["metadata"] = dict(payload.metadata)
    elif isinstance(payload, SemanticSummaryPayload):
        extra["stage"] = payload.stage
        extra["summary"] = payload.summary
        if payload.highlights:
            extra["highlights"] = list(payload.highlights)
        if payload.score is not None:
            extra["confidence"] = payload.score
        if payload.extra:
            extra["details"] = dict(payload.extra)
    elif isinstance(payload, FinalInsightPayload):
        extra["stage"] = payload.stage
        extra["summary"] = payload.summary
        extra["insights"] = list(payload.insights)
        if payload.provenance:
            extra["provenance"] = [dict(item) for item in payload.provenance]

    return {key: value for key, value in extra.items() if value not in (None, [], {}, 0)}


async def _relay_blackboard_events(
    job_id: uuid.UUID, queue: asyncio.Queue[MessageEnvelope[Any] | None]
) -> None:
    while True:
        message = await queue.get()
        if message is None:
            queue.task_done()
            break

        try:
            stage = getattr(message.payload, "stage", None)
            agents = _STAGE_TO_AGENTS.get(stage)
            if not agents:
                continue

            extra = _build_progress_extra(message)
            for agent_name, step in agents:
                update_agent(job_id, agent_name, AgentStatus.RUNNING, step=step, extra=extra)
        finally:
            queue.task_done()


async def _run_pipeline_with_controller(job_id: uuid.UUID, document_in: DocumentIn) -> PipelineRunResult:
    controller = AsyncAgentController()
    queue = controller.blackboard.subscribe()
    consumer = asyncio.create_task(_relay_blackboard_events(job_id, queue))
    try:
        result = await controller.run(document_in)
        return result
    finally:
        await controller.blackboard.wait_finalized()
        await queue.join()
        controller.blackboard.unsubscribe(queue)
        await consumer


@shared_task(name="pipeline.run")
def run_pipeline(context: Dict[str, object]) -> None:
    job_id = uuid.UUID(context["job_id"])
    context.setdefault("started_at", dt.datetime.utcnow().isoformat())

    files: Iterable[Dict[str, object]] = context.get("files", [])  # type: ignore[assignment]
    if not files:
        set_job_result(job_id, JobStatus.FAILED, error_message="Nenhum arquivo para processar")
        return

    documents_in = _prepare_documents(job_id, files)
    budget_context = context.get("token_budget") if isinstance(context, dict) else None
    budget_manager = TokenBudgetManager.from_context(budget_context)
    orchestrator = PipelineOrchestrator(budget_manager=budget_manager)
    aggregated_results: List[Dict[str, object]] = []

    try:
        for index, document_in in enumerate(documents_in, start=1):
            _mark_agents_running(job_id, index, len(documents_in))
            pipeline_result = asyncio.run(_run_pipeline_with_controller(job_id, document_in))
            serialized = serialize_pipeline_result(pipeline_result)
            operations = build_operations_from_pipeline(serialized)
            icms_payload = icms_service.calculate_for_operations(operations)
            if icms_payload["entries"]:
                icms_service.write_report(job_id, icms_payload)
            persist_pipeline_artifacts(pipeline_result, icms_payload)

            totals = pipeline_result.accounting.totals or pipeline_result.document.totals
            aggregated_results.append(
                {
                    "documentId": pipeline_result.document.document_id,
                    "filename": pipeline_result.document.filename,
                    "totals": model_dump(totals) if totals else {},
                    "audit": serialized.get("audit", {}),
                    "classification": serialized.get("classification", {}),
                    "insight": serialized.get("insight", {}),
                    "fiscal": {"icms": icms_payload},
                }
            )

        _mark_agents_completed(job_id, len(documents_in))
    except TokenBudgetExceeded as exc:
        set_job_result(job_id, JobStatus.FAILED, error_message=str(exc))
        raise
    except Exception as exc:  # pragma: no cover - defensive
        set_job_result(job_id, JobStatus.FAILED, error_message=str(exc))
        raise
    else:
        set_job_result(job_id, JobStatus.COMPLETED, result_payload={"documents": aggregated_results})
