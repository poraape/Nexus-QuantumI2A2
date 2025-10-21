from __future__ import annotations

import pytest

from app.agents.accountant import AccountantAgent
from app.schemas import Document, DocumentItem, DocumentTotals


def build_document_with_zero_totals() -> Document:
    return Document(
        document_id="doc-001",
        filename="doc.xml",
        content_type="application/xml",
        storage_path="/tmp/doc.xml",
        metadata={"cfop": "5102"},
        items=[
            DocumentItem(
                sku="ABC",
                description="Produto A",
                quantity=2,
                unit_price=50.0,
                total_value=100.0,
            ),
            DocumentItem(
                sku="DEF",
                description="Produto B",
                quantity=1,
                unit_price=80.0,
                total_value=80.0,
            ),
        ],
        totals=DocumentTotals(items_total=0.0, taxes_total=0.0, grand_total=0.0),
    )


def test_recompute_totals(monkeypatch) -> None:
    monkeypatch.setattr("app.agents.accountant.append_fix_report", lambda **_: None)

    document = build_document_with_zero_totals()
    repaired = AccountantAgent.recompute_totals(document)
    assert isinstance(repaired, Document)
    assert repaired.totals.grand_total == pytest.approx(180.0)
    assert repaired.totals.items_total == pytest.approx(180.0)
    assert repaired.totals.taxes_total == pytest.approx(0.0)
