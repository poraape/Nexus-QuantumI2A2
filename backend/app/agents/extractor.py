"""Extraction agent for document parsing and diagnostics."""
from __future__ import annotations

import logging
from typing import Any

from app.agents.base import Agent, retryable
from app.schemas import Document, DocumentIn, DocumentItem, DocumentTotals
from app.services import nlp_service, ocr_service
from app.services.diagnostic_logger import log_totals_event

logger = logging.getLogger(__name__)


class ExtractorAgent(Agent):
    name = "extractor"

    @retryable
    def run(self, document_in: DocumentIn) -> Document:
        def _execute() -> Document:
            logger.info("Iniciando extracao do documento: %s", document_in.storage_path)

            text = ocr_service.extract_text_from_file(document_in.storage_path)
            if not text:
                logger.warning("Nenhum texto extraido do documento: %s", document_in.storage_path)
                raise ValueError("Falha na extracao de texto do documento")

            items_data = nlp_service.extract_entities(text)
            if not items_data:
                logger.warning("Nenhum item extraido do texto do documento: %s", document_in.storage_path)
                raise ValueError("Nenhum item encontrado no documento")

            items: list[DocumentItem] = []
            taxes_total = 0.0

            def _extract_tax_total(raw_taxes: Any) -> float:
                if isinstance(raw_taxes, dict):
                    amount = 0.0
                    for value in raw_taxes.values():
                        if isinstance(value, dict):
                            amount += float(value.get("value", 0) or 0)
                        else:
                            try:
                                amount += float(value or 0)
                            except (TypeError, ValueError):
                                continue
                    return amount
                return 0.0

            for item_data in items_data:
                total_value = item_data.get("total_value")
                if not total_value:
                    logger.warning("Item sem valor total: %s", item_data)
                    continue

                item = DocumentItem(
                    sku=item_data.get("sku"),
                    description=item_data.get("description", ""),
                    quantity=item_data.get("quantity", 1.0),
                    unit_price=item_data.get("unit_price"),
                    total_value=total_value,
                )

                if item.total_value <= 0:
                    logger.warning("Item com valor total invalido: %s", item)
                    continue

                taxes_total += _extract_tax_total(item_data.get("taxes"))
                items.append(item)

            if not items:
                logger.error("Nenhum item valido extraido do documento")
                raise ValueError("Nenhum item valido encontrado no documento")

            items_total = sum(item.total_value for item in items)
            grand_total = items_total + taxes_total
            if grand_total <= 0:
                logger.error("Total geral invalido: %.2f", grand_total)
                raise ValueError("Total geral invalido")

            totals = DocumentTotals(
                items_total=items_total,
                taxes_total=taxes_total,
                grand_total=grand_total,
            )

            logger.info(
                "Extracao concluida. Itens=%s, total_itens=%.2f, total_impostos=%.2f, total_geral=%.2f",
                len(items),
                items_total,
                taxes_total,
                grand_total,
            )

            log_totals_event(
                agent=self.name,
                stage="post_extraction",
                document_id=document_in.document_id,
                totals=totals,
                status="computed",
                extra={"items": len(items)},
            )

            return Document(**document_in.model_dump(), items=items, totals=totals)

        return self._execute_with_metrics(_execute)
