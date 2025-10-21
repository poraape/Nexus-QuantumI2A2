from __future__ import annotations

from app.agents.intelligence import IntelligenceAgent
from app.schemas import AccountingOutput


def test_intelligence_requirement() -> None:
    agent = IntelligenceAgent()
    output = agent.run(
        AccountingOutput(
            document_id="doc",
            ledger_entries=[],
            sped_files=["sped.txt"],
        )
    )
    assert all(ref.exists for ref in output.provenance)
