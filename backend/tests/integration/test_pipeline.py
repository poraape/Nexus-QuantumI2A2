from __future__ import annotations

from pathlib import Path

from app.orchestrator.state_machine import PipelineOrchestrator
from app.schemas import DocumentIn


def test_pipeline_runs(monkeypatch) -> None:
    orchestrator = PipelineOrchestrator()
    fake_text = "1234 Produto 1 100,00"
    fake_entities = [
        {
            "sku": "1234",
            "description": "Produto",
            "quantity": 1,
            "unit_price": 100.0,
            "total_value": 100.0,
        }
    ]
    monkeypatch.setattr(
        "app.services.ocr_service.extract_text_from_file", lambda path: fake_text
    )
    monkeypatch.setattr(
        "backend.app.services.ocr_service.extract_text_from_file", lambda path: fake_text
    )
    monkeypatch.setattr(
        "app.services.nlp_service.extract_entities", lambda text: list(fake_entities)
    )
    monkeypatch.setattr(
        "backend.app.services.nlp_service.extract_entities",
        lambda text: list(fake_entities),
    )
    document_in = DocumentIn(
        document_id="doc-1",
        filename="demo.txt",
        content_type="text/plain",
        storage_path="/tmp/demo.txt",
        metadata={"cfop": "5102"},
    )
    Path(document_in.storage_path).write_text(fake_text, encoding="utf-8")
    result = orchestrator.run(document_in)
    assert result.insight.document_id == "doc-1"
    assert result.insight.provenance
    assert result.document.document_id == "doc-1"
