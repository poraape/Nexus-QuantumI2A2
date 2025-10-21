"""Agente de insights."""
from __future__ import annotations

from app.agents.base import Agent, retryable
from app.schemas import InsightReference, InsightReport
from app.services.llm_service import service as llm_service


class IntelligenceAgent(Agent):
    name = "intelligence"

    @retryable
    def run(self, accounting_output) -> InsightReport:  # type: ignore[override]
        def _execute() -> InsightReport:
            response = llm_service.run(
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
