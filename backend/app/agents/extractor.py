"""Agente responsável por extração."""
from __future__ import annotations

import logging
from typing import Any

from app.agents.base import Agent, retryable
from app.schemas import Document, DocumentIn, DocumentItem, DocumentTotals
from app.services import ocr_service, nlp_service

logger = logging.getLogger(__name__)

class ExtractorAgent(Agent):
    name = "extractor"

    @retryable
    def run(self, document_in: DocumentIn) -> Document:
        def _execute() -> Document:
            logger.info(f"Iniciando extração do documento: {document_in.storage_path}")
            
            # Extração do texto via OCR
            text = ocr_service.extract_text_from_file(document_in.storage_path)
            if not text:
                logger.warning(f"Nenhum texto extraído do documento: {document_in.storage_path}")
                raise ValueError("Falha na extração de texto do documento")

            # Extração de entidades via NLP
            items_data = nlp_service.extract_entities(text)
            if not items_data:
                logger.warning(f"Nenhum item extraído do texto do documento: {document_in.storage_path}")
                raise ValueError("Nenhum item encontrado no documento")

            # Processamento dos itens
            items = []
            for item_data in items_data:
                if not item_data.get("total_value"):
                    logger.warning(f"Item sem valor total: {item_data}")
                    continue

                item = DocumentItem(
                    sku=item_data.get("sku"),
                    description=item_data.get("description", ""),
                    quantity=item_data.get("quantity", 1.0),
                    unit_price=item_data.get("unit_price"),
                    total_value=item_data.get("total_value")
                )
                
                # Validação do item
                if item.total_value <= 0:
                    logger.warning(f"Item com valor total inválido: {item}")
                    continue
                
                items.append(item)

            if not items:
                logger.error("Nenhum item válido extraído do documento")
                raise ValueError("Nenhum item válido encontrado no documento")

            # Cálculo dos totais
            grand_total = sum(item.total_value for item in items)
            if grand_total <= 0:
                logger.error(f"Total geral inválido: {grand_total}")
                raise ValueError("Total geral inválido")

            totals = DocumentTotals(items_total=grand_total, grand_total=grand_total)
            logger.info(f"Extração concluída. Total de itens: {len(items)}, Valor total: {grand_total}")
            
            return Document(**document_in.model_dump(), items=items, totals=totals)

        return self._execute_with_metrics(_execute)
