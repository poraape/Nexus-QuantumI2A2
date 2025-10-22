"""Pipeline orchestrator chaining the agents with totals validation."""
from __future__ import annotations

import logging
from typing import Any

from app.agents.accountant import AccountantAgent
from app.agents.auditor import AuditorAgent
from app.agents.classifier import ClassifierAgent
from app.agents.extractor import ExtractorAgent
from app.agents.intelligence import IntelligenceAgent
from app.core.totals import ensure_document_totals, to_float, totals_as_dict
from app.schemas import DocumentIn, InsightReport
from app.services.diagnostic_logger import log_totals_event, update_post_validation_benchmark

logger = logging.getLogger(__name__)


class PipelineOrchestrator:
    def __init__(self) -> None:
        self.extractor = ExtractorAgent()
        self.auditor = AuditorAgent()
        self.classifier = ClassifierAgent()
        self.accountant = AccountantAgent()
        self.intelligence = IntelligenceAgent()

    def _totals_needs_attention(self, totals: Any) -> bool:
        if totals is None:
            return True
        totals_dict = totals_as_dict(totals)
        return any(to_float(value) == 0.0 for value in totals_dict.values())

    def run(self, document_in: DocumentIn) -> InsightReport:
        document = self.extractor.run(document_in)
        document = ensure_document_totals(document)  # type: ignore[assignment]
        logger.info(
            {
                "evt": "orchestrate_step",
                "step": "extract",
                "doc_id": document_in.document_id,
                "items": len(getattr(document, "items", [])),
                "totals": totals_as_dict(document.totals),
            }
        )

        audit = self.auditor.run(document)
        classification = self.classifier.run(audit)
        accounting = self.accountant.run(classification)
        logger.info(
            {
                "evt": "orchestrate_step",
                "step": "account",
                "doc_id": document_in.document_id,
                "totals": totals_as_dict(accounting.totals),
            }
        )

        if self._totals_needs_attention(accounting.totals):
            logger.warning(
                "Null totals detected for document %s. Triggering AccountantAgent recompute.",
                document_in.document_id,
            )
            if accounting.document is not None:
                repaired_document = AccountantAgent.recompute_totals(
                    accounting.document, document_id=document_in.document_id
                )
                if hasattr(repaired_document, "totals"):
                    accounting.document = repaired_document
                    accounting.totals = getattr(repaired_document, "totals", accounting.totals)
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
        logger.info(
            {
                "evt": "orchestrate_step",
                "step": "post_validation",
                "doc_id": document_in.document_id,
                "totals": totals_as_dict(accounting.totals),
            }
        )

        insights = self.intelligence.run(accounting)
        return insights


def build_pipeline() -> PipelineOrchestrator:
    return PipelineOrchestrator()
