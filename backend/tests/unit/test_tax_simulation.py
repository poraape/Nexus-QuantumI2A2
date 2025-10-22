from __future__ import annotations

from app.core.tax_simulation import simulate_icms_scenarios
from app.schemas import Document, DocumentIn, DocumentItem, DocumentTotals


def build_document() -> Document:
    base = DocumentIn(
        document_id="doc-sim",
        filename="doc.xml",
        content_type="application/xml",
        storage_path="/tmp/doc.xml",
        metadata={"origem_uf": "SP", "destino_uf": "RJ"},
    )
    document = Document(
        **base.model_dump(),
        items=[
            DocumentItem(
                sku="ABC",
                description="Item A",
                quantity=1,
                unit_price=100.0,
                total_value=100.0,
            ),
            DocumentItem(
                sku="DEF",
                description="Item B",
                quantity=2,
                unit_price=150.0,
                total_value=300.0,
            ),
        ],
        totals=DocumentTotals(items_total=400.0, taxes_total=0.0, grand_total=400.0),
    )
    return document


def test_simulate_icms_scenarios_populates_metadata() -> None:
    document = build_document()
    simulate_icms_scenarios(document)
    assert "what_if_icms" in document.metadata
    assert document.metadata["what_if_icms"]["RJ"]["icms_estimado"] == 48.0


def test_simulate_icms_scenarios_uses_overrides() -> None:
    document = build_document()
    simulate_icms_scenarios(document, overrides={"RJ": 0.2})
    assert document.metadata["what_if_icms"]["RJ"]["icms_estimado"] == 80.0
