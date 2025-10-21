from __future__ import annotations

from app.orchestrator.state_machine import PipelineOrchestrator
from app.schemas import DocumentIn


def test_pipeline_runs() -> None:
    orchestrator = PipelineOrchestrator()
    document_in = DocumentIn(
        document_id="doc-1",
        filename="demo.txt",
        content_type="text/plain",
        storage_path="/tmp/demo.txt",
        metadata={"cfop": "5102"},
    )
    report = orchestrator.run(document_in)
    assert report.document_id == "doc-1"
    assert report.provenance
