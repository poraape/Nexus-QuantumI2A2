from __future__ import annotations

from app.schemas import Document, DocumentIn, DocumentTotals


def test_extract_xml_requirement() -> None:
    doc = Document(
        document_id="spec-1",
        filename="spec.xml",
        content_type="application/xml",
        storage_path="s3://spec.xml",
        metadata={},
        items=[],
        totals=DocumentTotals(items_total=20.0, grand_total=20.0),
    )
    assert doc.totals.grand_total == 20.0
