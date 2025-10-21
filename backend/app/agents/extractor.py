"""Agente responsável por extração."""
from __future__ import annotations

from typing import Any

from app.agents.base import Agent, retryable
from app.schemas import Document, DocumentIn, DocumentItem, DocumentTotals
from app.services import ocr_service, nlp_service


class ExtractorAgent(Agent):
    name = "extractor"

    @retryable
    def run(self, document_in: DocumentIn) -> Document:
        def _execute() -> Document:
            text = ocr_service.extract_text_from_file(document_in.storage_path)
            items_data = nlp_service.extract_entities(text)
            items = [
                DocumentItem(
                    sku=item.get("sku"),
                    description=item.get("description", ""),
                    quantity=item.get("quantity", 1.0),
                    unit_price=item.get("unit_price", 0.0),
                    total_value=item.get("total_value", 0.0),
                )
                for item in items_data
            ]
            grand_total = sum(item.total_value for item in items)
            totals = DocumentTotals(items_total=grand_total, grand_total=grand_total)
            return Document(**document_in.model_dump(), items=items, totals=totals)

        return self._execute_with_metrics(_execute)
