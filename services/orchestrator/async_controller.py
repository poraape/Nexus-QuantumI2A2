"""Asynchronous agent orchestration with a shared blackboard."""
from __future__ import annotations

import asyncio
import time
from functools import partial
from typing import Any, Awaitable, Callable, Dict, List, Mapping, Optional, Sequence

from backend.app.agents.accountant import AccountantAgent
from backend.app.core.totals import ensure_document_totals
from backend.app.orchestrator.state_machine import PipelineOrchestrator as SyncPipelineOrchestrator
from backend.app.orchestrator.state_machine import PipelineRunResult
from backend.app.schemas import AccountingOutput, AuditReport, ClassificationResult, Document, DocumentIn, InsightReport
from backend.app.services.diagnostic_logger import log_totals_event, update_post_validation_benchmark
from backend.app.utils import model_dump

from services.agents.efficiency_guard import EfficiencyGuardAgent

from .schemas import (
    BlackboardSnapshot,
    FinalInsightPayload,
    MessageEnvelope,
    RawDataPayload,
    SemanticSummaryPayload,
)

BeforeHook = Callable[[str, Mapping[str, Any]], Awaitable[None]]
AfterHook = Callable[[str, Mapping[str, Any]], Awaitable[None]]


class SharedBlackboard:
    """Lightweight async blackboard used to share agent outputs."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._raw: List[MessageEnvelope[RawDataPayload]] = []
        self._summaries: List[MessageEnvelope[SemanticSummaryPayload]] = []
        self._insights: List[MessageEnvelope[FinalInsightPayload]] = []
        self._subscribers: set[asyncio.Queue[MessageEnvelope[Any] | None]] = set()
        self._finalized = False
        self._finalized_event = asyncio.Event()

    async def publish_raw(
        self,
        agent: str,
        payload: RawDataPayload,
        *,
        tokens: Optional[int] = None,
        latency_ms: Optional[float] = None,
        correlation_id: Optional[str] = None,
    ) -> MessageEnvelope[RawDataPayload]:
        envelope = MessageEnvelope(
            agent=agent,
            kind="raw",
            payload=payload,
            tokens=tokens,
            latency_ms=latency_ms,
            correlation_id=correlation_id,
        )
        await self._store_and_broadcast(envelope)
        return envelope

    async def publish_summary(
        self,
        agent: str,
        payload: SemanticSummaryPayload,
        *,
        tokens: Optional[int] = None,
        latency_ms: Optional[float] = None,
        correlation_id: Optional[str] = None,
    ) -> MessageEnvelope[SemanticSummaryPayload]:
        envelope = MessageEnvelope(
            agent=agent,
            kind="summary",
            payload=payload,
            tokens=tokens,
            latency_ms=latency_ms,
            correlation_id=correlation_id,
        )
        await self._store_and_broadcast(envelope)
        return envelope

    async def publish_insight(
        self,
        agent: str,
        payload: FinalInsightPayload,
        *,
        tokens: Optional[int] = None,
        latency_ms: Optional[float] = None,
        correlation_id: Optional[str] = None,
    ) -> MessageEnvelope[FinalInsightPayload]:
        envelope = MessageEnvelope(
            agent=agent,
            kind="insight",
            payload=payload,
            tokens=tokens,
            latency_ms=latency_ms,
            correlation_id=correlation_id,
        )
        await self._store_and_broadcast(envelope)
        return envelope

    async def _store_and_broadcast(self, envelope: MessageEnvelope[Any]) -> None:
        async with self._lock:
            if envelope.kind == "raw":
                self._raw.append(envelope)
            elif envelope.kind == "summary":
                self._summaries.append(envelope)  # type: ignore[arg-type]
            else:
                self._insights.append(envelope)  # type: ignore[arg-type]
            subscribers = list(self._subscribers)
        for queue in subscribers:
            await queue.put(envelope)

    def subscribe(self) -> asyncio.Queue[MessageEnvelope[Any] | None]:
        queue: asyncio.Queue[MessageEnvelope[Any] | None] = asyncio.Queue()
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[MessageEnvelope[Any] | None]) -> None:
        self._subscribers.discard(queue)

    async def finalize(self) -> None:
        async with self._lock:
            if self._finalized:
                return
            self._finalized = True
            subscribers = list(self._subscribers)
        for queue in subscribers:
            await queue.put(None)
        self._finalized_event.set()

    async def wait_finalized(self) -> None:
        await self._finalized_event.wait()

    async def snapshot(self) -> BlackboardSnapshot:
        async with self._lock:
            return BlackboardSnapshot(
                raw_data=list(self._raw),
                semantic_summaries=list(self._summaries),
                insights=list(self._insights),
            )


class AsyncAgentController:
    """Asynchronous orchestrator coordinating the pipeline agents."""

    def __init__(self) -> None:
        self.blackboard = SharedBlackboard()
        self._sync_pipeline = SyncPipelineOrchestrator()
        self.extractor = self._sync_pipeline.extractor
        self.auditor = self._sync_pipeline.auditor
        self.classifier = self._sync_pipeline.classifier
        self.accountant = self._sync_pipeline.accountant
        self.intelligence = self._sync_pipeline.intelligence
        self._load_corrections = self._sync_pipeline._load_corrections
        self._totals_needs_attention = self._sync_pipeline._totals_needs_attention

        self._before_hooks: List[BeforeHook] = []
        self._after_hooks: List[AfterHook] = []

        self.efficiency_guard = EfficiencyGuardAgent()
        self.efficiency_guard.attach(self)

    def register_before_hook(self, hook: BeforeHook) -> None:
        self._before_hooks.append(hook)

    def register_after_hook(self, hook: AfterHook) -> None:
        self._after_hooks.append(hook)

    async def run(self, document_in: DocumentIn) -> PipelineRunResult:
        try:
            document, doc_tokens, doc_latency = await self._run_agent(
                "extractor",
                self.extractor.run,
                document_in,
                stage="extraction",
            )
            document = self._ensure_document_totals(document)
            await self.blackboard.publish_raw(
                "extractor",
                RawDataPayload(
                    document_id=document.document_id,
                    stage="extraction",
                    data=model_dump(document),
                    metadata=document.metadata or {},
                ),
                tokens=doc_tokens,
                latency_ms=doc_latency,
            )

            audit, audit_tokens, audit_latency = await self._run_agent(
                "auditor", self.auditor.run, document, stage="audit"
            )
            await self.blackboard.publish_summary(
                "auditor",
                self._build_audit_summary(audit),
                tokens=audit_tokens,
                latency_ms=audit_latency,
            )

            corrections = self._load_corrections(getattr(document_in, "metadata", {}))
            classification, class_tokens, class_latency = await self._run_agent(
                "classifier",
                self.classifier.run,
                audit,
                stage="classification",
                corrections=corrections,
            )
            await self.blackboard.publish_summary(
                "classifier",
                self._build_classification_summary(classification),
                tokens=class_tokens,
                latency_ms=class_latency,
            )

            accounting, acc_tokens, acc_latency = await self._run_agent(
                "accountant", self.accountant.run, classification, stage="accounting"
            )
            await self._handle_accounting_totals(document_in, accounting)
            await self.blackboard.publish_summary(
                "accountant",
                self._build_accounting_summary(accounting),
                tokens=acc_tokens,
                latency_ms=acc_latency,
            )

            insight, insight_tokens, insight_latency = await self._run_agent(
                "intelligence", self.intelligence.run, accounting, stage="insight"
            )
            await self.blackboard.publish_insight(
                "intelligence",
                self._build_insight_payload(insight),
                tokens=insight_tokens,
                latency_ms=insight_latency,
            )

            return PipelineRunResult(
                document=document,
                audit=audit,
                classification=classification,
                accounting=accounting,
                insight=insight,
            )
        finally:
            await self.blackboard.finalize()

    async def _run_agent(
        self,
        agent_name: str,
        func: Callable[..., Any],
        *args: Any,
        stage: str,
        **kwargs: Any,
    ) -> tuple[Any, Optional[int], Optional[float]]:
        await self._notify_before(agent_name, stage, args, kwargs)
        loop = asyncio.get_running_loop()
        call = partial(func, *args, **kwargs)
        start = time.perf_counter()
        result = await loop.run_in_executor(None, call)
        latency_ms = (time.perf_counter() - start) * 1000
        tokens = self._estimate_tokens(args, kwargs, result)
        await self._notify_after(agent_name, stage, result, tokens, latency_ms)
        return result, tokens, latency_ms

    async def _notify_before(
        self,
        agent_name: str,
        stage: str,
        args: Sequence[Any],
        kwargs: Mapping[str, Any],
    ) -> None:
        if not self._before_hooks:
            return
        payload = {
            "stage": stage,
            "document_id": self._extract_document_id(args),
            "args": self._shrink_payload(args),
            "kwargs": self._shrink_payload(kwargs),
        }
        await asyncio.gather(*(hook(agent_name, payload) for hook in self._before_hooks))

    async def _notify_after(
        self,
        agent_name: str,
        stage: str,
        result: Any,
        tokens: Optional[int],
        latency_ms: Optional[float],
    ) -> None:
        if not self._after_hooks:
            return
        payload = {
            "stage": stage,
            "document_id": getattr(result, "document_id", None),
            "tokens": tokens,
            "latency_ms": latency_ms,
        }
        await asyncio.gather(*(hook(agent_name, payload) for hook in self._after_hooks))

    def _estimate_tokens(self, args: Sequence[Any], kwargs: Mapping[str, Any], result: Any) -> int:
        total = 0
        for item in list(args) + [kwargs, result]:
            total += self._rough_token_count(item)
        return total

    def _rough_token_count(self, value: Any) -> int:
        if value is None:
            return 0
        if isinstance(value, str):
            return max(1, len(value) // 4)
        if isinstance(value, Mapping):
            return sum(self._rough_token_count(k) + self._rough_token_count(v) for k, v in value.items())
        if isinstance(value, (list, tuple, set)):
            return sum(self._rough_token_count(item) for item in value)
        if hasattr(value, "model_dump"):
            return self._rough_token_count(value.model_dump())
        if hasattr(value, "dict"):
            return self._rough_token_count(value.dict())  # type: ignore[call-arg]
        return self._rough_token_count(str(value))

    def _extract_document_id(self, args: Sequence[Any]) -> Optional[str]:
        for item in args:
            if hasattr(item, "document_id"):
                doc_id = getattr(item, "document_id", None)
                if isinstance(doc_id, str):
                    return doc_id
        return None

    def _shrink_payload(self, data: Any) -> Any:
        if isinstance(data, Mapping):
            return {key: self._shrink_payload(value) for key, value in list(data.items())[:5]}
        if isinstance(data, (list, tuple)):
            return [self._shrink_payload(item) for item in list(data)[:5]]
        if hasattr(data, "model_dump"):
            return self._shrink_payload(data.model_dump())
        if hasattr(data, "dict"):
            return self._shrink_payload(data.dict())  # type: ignore[call-arg]
        return data

    def _ensure_document_totals(self, document: Document) -> Document:
        return ensure_document_totals(document)  # type: ignore[return-value]

    def _build_audit_summary(self, report: AuditReport) -> SemanticSummaryPayload:
        highlights = [f"{issue.code}: {issue.message}" for issue in report.issues]
        summary = "Documento aprovado na auditoria" if report.passed else "Documento com pendências"
        return SemanticSummaryPayload(
            document_id=report.document_id,
            stage="audit",
            summary=summary,
            highlights=highlights,
            extra={"issues": [model_dump(issue) for issue in report.issues]},
        )

    def _build_classification_summary(self, result: ClassificationResult) -> SemanticSummaryPayload:
        summary = f"Tipo {result.type} para setor {result.sector}"
        return SemanticSummaryPayload(
            document_id=result.document_id,
            stage="classification",
            summary=summary,
            highlights=[f"Confiança: {result.confidence:.2f}"],
            score=result.confidence,
        )

    def _build_accounting_summary(self, accounting: AccountingOutput) -> SemanticSummaryPayload:
        totals = getattr(accounting, "totals", None)
        summary = "Totais contábeis calculados"
        extra: Dict[str, Any] = {}
        if totals is not None:
            extra["totals"] = model_dump(totals)
        return SemanticSummaryPayload(
            document_id=accounting.document_id,
            stage="accounting",
            summary=summary,
            highlights=[
                f"Entradas fiscais: {len(accounting.ledger_entries)}",
                f"SPED gerado: {len(accounting.sped_files)} arquivo(s)",
            ],
            extra=extra,
        )

    def _build_insight_payload(self, insight: InsightReport) -> FinalInsightPayload:
        return FinalInsightPayload(
            document_id=insight.document_id,
            stage="insight",
            summary=insight.summary,
            insights=list(insight.recommendations),
            provenance=[model_dump(item) for item in insight.provenance],
        )

    async def _handle_accounting_totals(
        self, document_in: DocumentIn, accounting: AccountingOutput
    ) -> None:
        totals = getattr(accounting, "totals", None)
        if self._totals_needs_attention(totals):
            if accounting.document is not None:
                repaired = AccountantAgent.recompute_totals(
                    accounting.document, document_id=document_in.document_id
                )
                if hasattr(repaired, "totals"):
                    accounting.document = repaired  # type: ignore[assignment]
                    accounting.totals = getattr(repaired, "totals", accounting.totals)
                    log_totals_event(
                        agent="orchestrator",
                        stage="post_accountant_validation",
                        document_id=document_in.document_id,
                        totals=accounting.totals,
                        status="recomputed",
                    )

        update_post_validation_benchmark(
            document_id=document_in.document_id,
            totals=accounting.totals,
            notes="post_accountant_validation",
        )
