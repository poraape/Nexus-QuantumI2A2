"""Deterministic cross-validation agent used between accounting and insights."""
from __future__ import annotations

from dataclasses import dataclass
from typing import List

from app.agents.base import Agent, retryable
from app.core.totals import to_float, totals_as_dict
from app.schemas import (
    AccountingOutput,
    AuditReport,
    ClassificationResult,
    CrossValidationFinding,
    CrossValidationReport,
    Document,
)
from app.services.diagnostic_logger import log_totals_event


@dataclass(slots=True)
class _TotalsSnapshot:
    grand_total: float
    items_total: float
    taxes_total: float


class CrossValidatorAgent(Agent):
    """Runs consistency checks and materializes deterministic operations."""

    name = "crossValidator"

    def __init__(self, *, tolerance: float = 5.0, confidence_floor: float = 0.65) -> None:
        super().__init__()
        self._tolerance = abs(tolerance)
        self._confidence_floor = confidence_floor

    @retryable
    def run(
        self,
        document: Document,
        audit: AuditReport,
        classification: ClassificationResult,
        accounting: AccountingOutput,
    ) -> CrossValidationReport:
        def _execute() -> CrossValidationReport:
            log_totals_event(
                agent=self.name,
                stage="consistency_pre_check",
                document_id=document.document_id,
                totals=document.totals,
                status="received",
                extra={"confidence": classification.confidence},
            )

            operations = self._build_operations(document)
            findings: List[CrossValidationFinding] = []

            doc_totals = self._snapshot(document)
            acc_totals = self._snapshot(accounting.document or document, accounting.totals)

            if self._is_out_of_tolerance(doc_totals.grand_total, acc_totals.grand_total):
                findings.append(
                    CrossValidationFinding(
                        code="GRAND_TOTAL_MISMATCH",
                        message=(
                            "Diferença entre total do documento e total contábil acima da tolerância"
                        ),
                        severity="critical",
                        context={
                            "document": doc_totals.grand_total,
                            "accounting": acc_totals.grand_total,
                            "tolerance": self._tolerance,
                        },
                    )
                )

            if classification.confidence < self._confidence_floor:
                findings.append(
                    CrossValidationFinding(
                        code="LOW_CLASSIFICATION_CONFIDENCE",
                        message="Confiança do classificador abaixo do mínimo permitido",
                        severity="warning",
                        context={"confidence": classification.confidence},
                    )
                )

            for issue in audit.issues:
                if issue.severity.lower() in {"error", "critical"}:
                    findings.append(
                        CrossValidationFinding(
                            code=f"AUDIT::{issue.code}",
                            message=issue.message,
                            severity="critical",
                            context={"severity": issue.severity},
                        )
                    )

            report = CrossValidationReport(
                document_id=document.document_id,
                operations=operations,
                findings=findings,
            )

            log_totals_event(
                agent=self.name,
                stage="consistency_post_check",
                document_id=document.document_id,
                totals=document.totals,
                status="completed",
                extra={
                    "operations": len(operations),
                    "findings": len(findings),
                },
            )

            return report

        return self._execute_with_metrics(_execute)

    def _snapshot(
        self,
        document: Document,
        totals_override: object | None = None,
    ) -> _TotalsSnapshot:
        totals = totals_override or document.totals
        totals_dict = totals_as_dict(totals)
        return _TotalsSnapshot(
            grand_total=to_float(totals_dict.get("grand_total")),
            items_total=to_float(totals_dict.get("items_total")),
            taxes_total=to_float(totals_dict.get("taxes_total")),
        )

    def _is_out_of_tolerance(self, base: float, other: float) -> bool:
        return abs(base - other) > self._tolerance

    def _build_operations(self, document: Document) -> List[dict[str, object]]:
        operations: List[dict[str, object]] = []
        for index, item in enumerate(document.items, start=1):
            operations.append(
                {
                    "id": f"{document.document_id}-item-{index}",
                    "sku": item.sku,
                    "description": item.description,
                    "quantity": float(item.quantity),
                    "total_value": float(item.total_value),
                }
            )
        return operations

