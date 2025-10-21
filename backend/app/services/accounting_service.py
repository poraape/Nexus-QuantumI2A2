"""Serviço de contabilidade simplificado."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from app.schemas import AccountingOutput


def generate_sped_stub(audited_docs: list[dict[str, Any]]) -> AccountingOutput:
    ledger_entries = []
    total = 0.0
    for doc in audited_docs:
        for item in doc.get("items", []):
            total += float(item.get("total_value", 0))
            ledger_entries.append(
                {
                    "account_code": "1.1.1",
                    "description": item.get("description", "Item"),
                    "amount": float(item.get("total_value", 0)),
                }
            )
    sped_name = f"sped-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}.txt"
    return AccountingOutput(
        document_id=audited_docs[0]["document_id"] if audited_docs else "unknown",
        ledger_entries=ledger_entries,
        sped_files=[sped_name],
    )
