from __future__ import annotations

from pathlib import Path

from app.agents.extractor import ExtractorAgent
from app.schemas import DocumentIn


def test_extractor_returns_document(monkeypatch) -> None:
    agent = ExtractorAgent()

    fake_text = "1234 Produto 10,00"
    fake_entities = [
        {
            "sku": "1234",
            "description": "Produto",
            "quantity": 1,
            "unit_price": 10,
            "total_value": 10,
        }
    ]
    monkeypatch.setattr("app.services.ocr_service.extract_text_from_file", lambda path: fake_text)
    monkeypatch.setattr(
        "backend.app.services.ocr_service.extract_text_from_file", lambda path: fake_text
    )
    monkeypatch.setattr("app.services.nlp_service.extract_entities", lambda text: list(fake_entities))
    monkeypatch.setattr(
        "backend.app.services.nlp_service.extract_entities", lambda text: list(fake_entities)
    )

    document_in = DocumentIn(
        document_id="d1",
        filename="demo.xml",
        content_type="application/xml",
        storage_path="/tmp/file",
        metadata={},
    )
    Path(document_in.storage_path).write_text(fake_text, encoding="utf-8")

    doc = agent.run(document_in)
    assert doc.document_id == "d1"
    assert doc.totals.grand_total == 10
