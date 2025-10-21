"""Agente contábil."""
from __future__ import annotations

from app.agents.base import Agent, retryable
from app.schemas import AccountingOutput, ClassificationResult
from app.services import accounting_service


class AccountantAgent(Agent):
    name = "accountant"

    @retryable
    def run(self, classification: ClassificationResult) -> AccountingOutput:
        def _execute() -> AccountingOutput:
            audited_docs = [
                {
                    "document_id": classification.document_id,
                    "items": [
                        {
                            "description": "Item genérico",
                            "total_value": 100.0,
                        }
                    ],
                }
            ]
            return accounting_service.generate_sped_stub(audited_docs)

        return self._execute_with_metrics(_execute)
