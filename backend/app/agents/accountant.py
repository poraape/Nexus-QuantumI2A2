"""Accounting agent with totals recomputation safeguards."""
from __future__ import annotations

import logging
import time
from typing import Any, Iterable, Union

from app.agents.base import Agent, retryable
from app.schemas import AccountingOutput, ClassificationResult, Document, DocumentTotals
from app.services import accounting_service
from app.services.diagnostic_logger import append_fix_report, log_totals_event

logger = logging.getLogger(__name__)


class AccountantAgent(Agent):
    name = "accountant"

    @staticmethod
    def _iter_items(items: Iterable[Any]) -> Iterable[Any]:
        return items or []

    @staticmethod
    def _item_total(item: Any) -> float:
        if hasattr(item, "total_value"):
            return float(getattr(item, "total_value") or 0)
        if isinstance(item, dict):
            try:
                return float(item.get("total_value", 0) or 0)
            except (TypeError, ValueError):
                return 0.0
        return 0.0

    @staticmethod
    def _item_taxes(item: Any) -> float:
        taxes = None
        if hasattr(item, "taxes"):
            taxes = getattr(item, "taxes")
        elif isinstance(item, dict):
            taxes = item.get("taxes")

        if isinstance(taxes, dict):
            amount = 0.0
            for value in taxes.values():
                if isinstance(value, dict):
                    amount += float(value.get("value", 0) or 0)
                else:
                    try:
                        amount += float(value or 0)
                    except (TypeError, ValueError):
                        continue
            return amount
        return 0.0

    @staticmethod
    def _current_totals(document: Union[Document, dict[str, Any]]) -> dict[str, float]:
        if isinstance(document, Document) and document.totals:
            return document.totals.model_dump()
        if isinstance(document, dict):
            totals = document.get("totals", {})
            if isinstance(totals, dict):
                return dict(totals)
        return {}

    @staticmethod
    def recompute_totals(document: Union[Document, dict[str, Any]]) -> Union[Document, dict[str, Any]]:
        start = time.perf_counter()
        current_totals = AccountantAgent._current_totals(document)
        needs_recompute = not current_totals or any(
            value is None or float(value) == 0 for value in current_totals.values()
        )

        items_total = 0.0
        taxes_total = 0.0

        if isinstance(document, Document):
            items_iterable = AccountantAgent._iter_items(document.items)
        elif isinstance(document, dict):
            items_iterable = AccountantAgent._iter_items(document.get("items", []))
        else:
            items_iterable = []

        for item in items_iterable:
            items_total += AccountantAgent._item_total(item)
            taxes_total += AccountantAgent._item_taxes(item)

        grand_total = items_total + taxes_total
        doc_id = (
            document.document_id
            if isinstance(document, Document)
            else str(document.get("document_id", "unknown"))
        )

        status = "no_change"
        if needs_recompute or grand_total <= 0:
            status = "recomputed"
            new_totals = DocumentTotals(
                items_total=max(items_total, 0.0),
                taxes_total=max(taxes_total, 0.0),
                grand_total=max(grand_total, 0.0),
            )

            if isinstance(document, Document):
                document.totals = new_totals
            else:
                totals_dict = new_totals.model_dump()
                document.setdefault("totals", {})
                if isinstance(document["totals"], dict):
                    document["totals"].update(totals_dict)
                else:
                    document["totals"] = totals_dict
            append_fix_report(
                document_id=doc_id,
                old_totals=current_totals or None,
                new_totals=new_totals,
                duration_ms=(time.perf_counter() - start) * 1000,
                status=status,
            )
            logger.info("[FIX] Totals recomputed successfully for Document %s", doc_id)
        else:
            append_fix_report(
                document_id=doc_id,
                old_totals=current_totals or None,
                new_totals=current_totals or None,
                duration_ms=(time.perf_counter() - start) * 1000,
                status=status,
            )

        return document

    @retryable
    def run(self, classification: ClassificationResult) -> AccountingOutput:
        def _execute() -> AccountingOutput:
            logger.info("Processando documento: %s", classification.document_id)

            if not classification.document or not classification.document.items:
                logger.error("Documento %s sem itens", classification.document_id)
                raise ValueError("Documento sem itens para processar")

            log_totals_event(
                agent=self.name,
                stage="pre_accounting",
                document_id=classification.document_id,
                totals=classification.document.totals,
                status="received",
                extra={"items": len(classification.document.items)},
            )

            repaired_document = AccountantAgent.recompute_totals(classification.document)
            assert isinstance(repaired_document, Document)

            audited_docs = [
                {
                    "document_id": classification.document_id,
                    "items": [
                        {
                            "description": item.description,
                            "total_value": item.total_value,
                            "quantity": item.quantity,
                            "unit_price": item.unit_price,
                        }
                        for item in repaired_document.items
                    ],
                }
            ]

            totals = repaired_document.totals
            if not totals or totals.grand_total <= 0:
                logger.error(
                    "Total invalido para documento %s: %s",
                    classification.document_id,
                    totals.model_dump() if totals else None,
                )
                raise ValueError("Total do documento invalido")

            logger.info(
                "Gerando SPED para documento %s. Total: %.2f",
                classification.document_id,
                totals.grand_total,
            )
            output = accounting_service.generate_sped_stub(audited_docs)
            output.document = repaired_document
            output.totals = totals

            log_totals_event(
                agent=self.name,
                stage="post_accounting",
                document_id=classification.document_id,
                totals=totals,
                status="computed",
                extra={"items": len(repaired_document.items)},
            )

            return output

        return self._execute_with_metrics(_execute)
