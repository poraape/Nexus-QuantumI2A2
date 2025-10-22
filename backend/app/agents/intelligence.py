"""Intelligence agent that guards against incomplete totals."""
from __future__ import annotations

import logging
from typing import Any

from app.agents.base import Agent, retryable
from app.agents.accountant import AccountantAgent
from app.core.totals import ensure_document_totals, to_float, totals_as_dict
from app.schemas import InsightReference, InsightReport
from app.services.diagnostic_logger import log_totals_event
from app.services.llm_service import service as llm_service

logger = logging.getLogger(__name__)


class IntelligenceAgent(Agent):
    name = "intelligence"

    @retryable
    def run(self, accounting_output: Any) -> InsightReport:  # type: ignore[override]
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

            llm_service.run(
                prompt="Gere resumo executivo", schema={"type": "object", "properties": {}}
            )
            return InsightReport(
                document_id=accounting_output.document_id,
                title="Resumo executivo",
                summary="Pipeline executado com sucesso.",
                provenance=[InsightReference(description="LLM", exists=True)],
                recommendations=["Manter monitoramento"],
            )

        return self._execute_with_metrics(_execute)
