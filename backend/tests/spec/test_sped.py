from __future__ import annotations

from app.agents.accountant import AccountantAgent
from app.schemas import ClassificationResult, Document, DocumentItem, DocumentTotals


def test_sped_requirement() -> None:
    agent = AccountantAgent()
    document = Document(
        document_id="doc",
        filename="doc.xml",
        content_type="application/xml",
        storage_path="/tmp/doc.xml",
        metadata={},
        items=[
            DocumentItem(
                sku="A",
                description="Item",
                quantity=1,
                unit_price=100.0,
                total_value=100.0,
            )
        ],
        totals=DocumentTotals(items_total=100.0, taxes_total=0.0, grand_total=100.0),
    )
    classification = ClassificationResult(document_id="doc", type="NF", sector="Retail", document=document)
    output = agent.run(classification)
    assert output.sped_files
