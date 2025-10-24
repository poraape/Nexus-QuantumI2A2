"""Agente de classificação."""
from __future__ import annotations

from typing import Mapping, Optional

from app.agents.base import Agent, retryable
from app.schemas import AuditReport, ClassificationResult


class ClassifierAgent(Agent):
    name = "classifier"

    @retryable
    def run(self, report: AuditReport, corrections: Optional[Mapping[str, str]] = None) -> ClassificationResult:
        def _execute() -> ClassificationResult:
            doc_type = "NF-e" if report.passed else "NF-e-erro"
            sector = "Varejo"
            confidence = 0.9 if report.passed else 0.5
            result = ClassificationResult(
                document_id=report.document_id,
                type=doc_type,
                sector=sector,
                confidence=confidence,
                document=report.document,
            )

            if corrections:
                document_key = None
                if report.document is not None:
                    document_key = getattr(report.document, "filename", None)
                if not document_key:
                    document_key = report.document_id

                override = corrections.get(str(document_key))
                if override:
                    result.type = str(override)
                    result.confidence = 1.0

            return result

        return self._execute_with_metrics(_execute)
