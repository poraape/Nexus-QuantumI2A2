"""Agente contábil."""
from __future__ import annotations

import logging
from app.agents.base import Agent, retryable
from app.schemas import AccountingOutput, ClassificationResult
from app.services import accounting_service

logger = logging.getLogger(__name__)

class AccountantAgent(Agent):
    name = "accountant"

    @retryable
    def run(self, classification: ClassificationResult) -> AccountingOutput:
        def _execute() -> AccountingOutput:
            logger.info(f"Processando documento: {classification.document_id}")
            
            if not classification.document or not classification.document.items:
                logger.error(f"Documento {classification.document_id} sem itens")
                raise ValueError("Documento sem itens para processar")

            # Usa os valores reais do documento
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
                        for item in classification.document.items
                    ],
                }
            ]

            # Validação dos valores
            total = sum(item.total_value for item in classification.document.items)
            if total <= 0:
                logger.error(f"Total inválido para documento {classification.document_id}: {total}")
                raise ValueError("Total do documento inválido")

            logger.info(f"Gerando SPED para documento {classification.document_id}. Total: {total}")
            return accounting_service.generate_sped_stub(audited_docs)

        return self._execute_with_metrics(_execute)
