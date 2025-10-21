from __future__ import annotations

from app.agents.extractor import ExtractorAgent
from app.schemas import DocumentIn, DocumentTotals


def test_extractor_returns_document(monkeypatch) -> None:
    agent = ExtractorAgent()

    monkeypatch.setattr(
        "app.services.ocr_service.extract_text_from_file", lambda path: "1234 Produto 10,00"
    )
    monkeypatch.setattr(
        "app.services.nlp_service.extract_entities",
        lambda text: [
            {
                "sku": "1234",
                "description": "Produto",
                "quantity": 1,
                "unit_price": 10,
                "total_value": 10,
            }
        ],
    )

    document_in = DocumentIn(
        document_id="d1",
        filename="demo.xml",
        content_type="application/xml",
        storage_path="/tmp/file",
        metadata={},
    )

    doc = agent.run(document_in)
    assert doc.document_id == "d1"
    assert doc.totals.grand_total == 10
