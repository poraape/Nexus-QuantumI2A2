"""Intelligence agent that guards against incomplete totals."""
from __future__ import annotations

import json
import logging
from typing import Any, Iterable, List

from app.agents.accountant import AccountantAgent
from app.agents.base import Agent, retryable
from app.core.totals import ensure_document_totals, to_float, totals_as_dict
from app.schemas import InsightReference, InsightReport
from app.services.diagnostic_logger import log_totals_event
from app.services.agents.response_agent import response_agent_service

logger = logging.getLogger(__name__)


class IntelligenceAgent(Agent):
    name = "intelligence"

    def __init__(self, prompt_optimizer: PromptOptimizer | None = None) -> None:
        super().__init__()
        self.prompt_optimizer = prompt_optimizer or PromptOptimizer()

    @retryable
    def run(
        self,
        accounting_output: Any,
        *,
        budget_manager: TokenBudgetManager | None = None,
    ) -> InsightReport:  # type: ignore[override]
        def _execute() -> InsightReport:
            totals = getattr(accounting_output, "totals", None)
            document = getattr(accounting_output, "document", None)
            totals_dict = totals_as_dict(totals) if totals is not None else {}
            needs_repair = not totals_dict or any(to_float(value) == 0.0 for value in totals_dict.values())

            if needs_repair and document is not None:
                logger.warning(
                    "Incomplete totals detected for %s; requesting recompute before analysis.",
                    accounting_output.document_id,
                )
                repaired_document = AccountantAgent.recompute_totals(
                    document, document_id=accounting_output.document_id
                )
                if hasattr(repaired_document, "totals"):
                    accounting_output.document = repaired_document
                    accounting_output.totals = getattr(repaired_document, "totals", totals)
                    totals = accounting_output.totals
                    totals_dict = totals_as_dict(totals)
                    log_totals_event(
                        agent=self.name,
                        stage="pre_analysis_repair",
                        document_id=accounting_output.document_id,
                        totals=totals,
                        status="recomputed",
                    )
            elif document is not None:
                ensure_document_totals(document)
                totals = getattr(document, "totals", totals)
                totals_dict = totals_as_dict(totals)

            totals = getattr(accounting_output, "totals", totals)
            if totals is not None:
                totals_dict = totals_as_dict(totals)

            log_totals_event(
                agent=self.name,
                stage="pre_analysis",
                document_id=accounting_output.document_id,
                totals=totals if totals is not None else totals_dict,
                status="ready",
            )

            response_agent_service.generate_structured_response(
                prompt="Gere resumo executivo", schema={"type": "object", "properties": {}}
            )
            prompt_tokens = self.prompt_optimizer.estimate_tokens(optimized_prompt)

            if budget_manager:
                try:
                    budget_manager.consume_for_stage(
                        self.name,
                        "analysis",
                        getattr(accounting_output, "metadata", None),
                        tokens=prompt_tokens,
                    )
                except TokenBudgetExceeded as exc:
                    logger.warning("Budget exceeded for intelligence step: %s", exc)
                    return self._fallback_report(accounting_output.document_id, reason=str(exc))

            llm_service.run(prompt=optimized_prompt, schema={"type": "object", "properties": {}})
            return InsightReport(
                document_id=accounting_output.document_id,
                title="Resumo executivo",
                summary="Pipeline executado com sucesso.",
                provenance=[InsightReference(description="LLM", exists=True)],
                recommendations=["Manter monitoramento"],
            )

        return self._execute_with_metrics(_execute)

    def _build_context(self, accounting_output: Any) -> List[str]:
        context: List[str] = []
        document = getattr(accounting_output, "document", None)
        if document is not None:
            metadata = getattr(document, "metadata", None)
            if metadata:
                context.append(json.dumps({"metadata": metadata}, ensure_ascii=False))
            totals = getattr(document, "totals", None)
            if totals is not None:
                context.append(json.dumps({"totals": totals_as_dict(totals)}, ensure_ascii=False))

        ledger_entries = getattr(accounting_output, "ledger_entries", None)
        if isinstance(ledger_entries, Iterable):
            subset = list(ledger_entries)[:5]
            if subset:
                context.append(json.dumps({"ledger": subset}, ensure_ascii=False))

        sped_files = getattr(accounting_output, "sped_files", None)
        if isinstance(sped_files, Iterable):
            preview = list(sped_files)[:3]
            if preview:
                context.append(json.dumps({"spedFiles": preview}, ensure_ascii=False))

        return context

    def _fallback_report(self, document_id: str, *, reason: str) -> InsightReport:
        return InsightReport(
            document_id=document_id,
            title="Resumo executivo local",
            summary=f"Limite de tokens atingido. Fallback aplicado: {reason}",
            provenance=[InsightReference(description="Fallback local", exists=True)],
            recommendations=["Reexecutar com orçamento ampliado"],
        )
