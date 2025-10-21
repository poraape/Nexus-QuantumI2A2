from __future__ import annotations

from typing import Any, Dict

from app.orchestrator.state_machine import PipelineOrchestrator
from app.schemas import (
    Document,
    DocumentIn,
    DocumentItem,
    DocumentTotals,
    InsightReference,
    InsightReport,
)


def _build_document() -> Document:
    return Document(
        document_id="doc-101",
        filename="demo.xml",
        content_type="application/xml",
        storage_path="/tmp/demo.xml",
        metadata={"cfop": "5102"},
        items=[
            DocumentItem(
                sku="SKU1",
                description="Item 1",
                quantity=1,
                unit_price=120.0,
                total_value=120.0,
            ),
            DocumentItem(
                sku="SKU2",
                description="Item 2",
                quantity=2,
                unit_price=60.0,
                total_value=120.0,
            ),
        ],
        totals=DocumentTotals(items_total=0.0, taxes_total=0.0, grand_total=0.0),
    )


def test_null_total_correction(monkeypatch) -> None:
    orchestrator = PipelineOrchestrator()

    monkeypatch.setattr("app.agents.accountant.append_fix_report", lambda **_: None)
    monkeypatch.setattr("app.agents.accountant.log_totals_event", lambda **_: None)
    monkeypatch.setattr("app.orchestrator.state_machine.log_totals_event", lambda **_: None)
    monkeypatch.setattr("app.orchestrator.state_machine.update_post_validation_benchmark", lambda **_: None)
    monkeypatch.setattr("app.agents.intelligence.log_totals_event", lambda **_: None)

    monkeypatch.setattr(
        "app.agents.extractor.ExtractorAgent.run",
        lambda self, _: _build_document(),
        raising=False,
    )
    monkeypatch.setattr(
        "app.services.llm_service.service.run",
        lambda **_: {"summary": "ok"},
    )

    captured: Dict[str, Any] = {}

    def fake_intelligence_run(self, accounting_output):
        captured["totals"] = accounting_output.totals
        return InsightReport(
            document_id=accounting_output.document_id,
            title="Resumo executivo",
            summary="ok",
            provenance=[InsightReference(description="stub", exists=True)],
            recommendations=[],
        )

    monkeypatch.setattr(
        "app.agents.intelligence.IntelligenceAgent.run",
        fake_intelligence_run,
        raising=False,
    )

    document_in = DocumentIn(
        document_id="doc-101",
        filename="demo.xml",
        content_type="application/xml",
        storage_path="/tmp/demo.xml",
        metadata={"cfop": "5102"},
    )

    orchestrator.run(document_in)
    totals = captured.get("totals")
    assert totals is not None
    assert getattr(totals, "grand_total", 0) > 0
