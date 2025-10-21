from __future__ import annotations

from app.agents.classifier import ClassifierAgent
from app.schemas import AuditReport


def test_classification_requirement() -> None:
    agent = ClassifierAgent()
    report = AuditReport(document_id="doc", issues=[], passed=True)
    result = agent.run(report)
    assert result.type
    assert result.sector
