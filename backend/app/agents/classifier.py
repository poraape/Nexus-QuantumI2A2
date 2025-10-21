"""Agente de classificação."""
from __future__ import annotations

from app.agents.base import Agent, retryable
from app.schemas import AuditReport, ClassificationResult


class ClassifierAgent(Agent):
    name = "classifier"

    @retryable
    def run(self, report: AuditReport) -> ClassificationResult:
        def _execute() -> ClassificationResult:
            doc_type = "NF-e" if report.passed else "NF-e-erro"
            sector = "Varejo"
            confidence = 0.9 if report.passed else 0.5
            return ClassificationResult(
                document_id=report.document_id,
                type=doc_type,
                sector=sector,
                confidence=confidence,
            )

        return self._execute_with_metrics(_execute)
