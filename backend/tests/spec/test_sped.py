from __future__ import annotations

from app.agents.accountant import AccountantAgent
from app.schemas import ClassificationResult


def test_sped_requirement() -> None:
    agent = AccountantAgent()
    classification = ClassificationResult(document_id="doc", type="NF", sector="Retail")
    output = agent.run(classification)
    assert output.sped_files
