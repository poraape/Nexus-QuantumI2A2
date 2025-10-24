"""Accounting agent with totals recomputation safeguards."""
from __future__ import annotations

import logging
from typing import Any, Dict, Union

from app.agents.base import Agent, retryable
from app.core.tax_rules import adjust_icms_by_uf
from app.core.tax_simulation import simulate_icms_scenarios
from app.core.totals import ensure_document_totals, to_float, totals_as_dict
from app.schemas import AccountingOutput, ClassificationResult, Document
from app.utils import model_dump
from app.services import accounting_service
from app.services.diagnostic_logger import append_fix_report, log_totals_event

logger = logging.getLogger(__name__)


class AccountantAgent(Agent):
    name = "accountant"

    @staticmethod
    def apply_icms_adjustment(document: Document) -> Document:
        metadata = document.metadata or {}
        origem = (
            metadata.get("origem_uf")
            or metadata.get("emitente_uf")
            or metadata.get("uf_origem")
            or "SP"
        )
        destino = (
            metadata.get("destino_uf")
            or metadata.get("destinatario_uf")
            or metadata.get("uf_destino")
            or "SP"
        )

        override_config = metadata.get("icms_overrides") if isinstance(metadata, dict) else {}
        destination_overrides: Dict[str, float] = {}
        pair_overrides: Dict[tuple[str, str], float] = {}

        if isinstance(override_config, dict):
            for key, value in override_config.items():
                try:
                    rate = float(value)
                except (TypeError, ValueError):
                    continue
                if rate > 1:
                    rate = rate / 100.0

                if isinstance(key, (tuple, list)) and len(key) == 2:
                    pair_overrides[(str(key[0]).upper(), str(key[1]).upper())] = rate
                elif isinstance(key, str) and "->" in key:
                    parts = key.split("->")
                    if len(parts) == 2:
                        pair_overrides[(parts[0].strip().upper(), parts[1].strip().upper())] = rate
                elif isinstance(key, str):
                    destination_overrides[key.strip().upper()] = rate

        icms_breakdown = []
        icms_total = 0.0
        for item in document.items:
            base = to_float(getattr(item, "total_value", 0.0))
            icms_value = adjust_icms_by_uf(
                str(origem),
                str(destino),
                base,
                overrides=pair_overrides,
                default_overrides=destination_overrides,
            )
            icms_total += icms_value
            icms_breakdown.append(
                {
                    "sku": getattr(item, "sku", None),
                    "icms": icms_value,
                }
            )

        document.metadata["icms_adjustments"] = icms_breakdown
        document.totals.taxes_total = max(icms_total, document.totals.taxes_total)
        document.totals.grand_total = document.totals.items_total + document.totals.taxes_total

        simulate_icms_scenarios(document, overrides=destination_overrides)

        logger.info(
            "[ICMS Adjusted] UF %s->%s, Total ICMS: %.2f",
            origem,
            destino,
            document.totals.taxes_total,
        )
        return document

    @staticmethod
    def recompute_totals(document: Union[Document, dict[str, Any]], *, document_id: str | None = None) -> Union[Document, dict[str, Any]]:
        before = totals_as_dict(
            document.totals if isinstance(document, Document) else (document.get("totals") if isinstance(document, dict) else {})
        )
        ensure_document_totals(document)
        after = totals_as_dict(
            document.totals if isinstance(document, Document) else (document.get("totals") if isinstance(document, dict) else {})
        )

        doc_id = document_id or (
            document.document_id if isinstance(document, Document) else str(document.get("document_id", "unknown"))
        )

        status = "no_change"
        if any(to_float(before.get(key)) != to_float(after.get(key)) for key in after.keys()):
            status = "recomputed"
            logger.info("[FIX] Totals recomputed successfully for Document %s", doc_id)

        append_fix_report(
            document_id=doc_id,
            old_totals=before,
            new_totals=after,
            duration_ms=0.0,
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

            repaired_document = AccountantAgent.recompute_totals(
                classification.document, document_id=classification.document_id
            )
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
                    model_dump(totals) if totals else None,
                )
                raise ValueError("Total do documento invalido")

            logger.info(
                "Gerando SPED para documento %s. Total: %.2f",
                classification.document_id,
                totals.grand_total,
            )

            repaired_document = AccountantAgent.apply_icms_adjustment(repaired_document)
            totals = repaired_document.totals

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
