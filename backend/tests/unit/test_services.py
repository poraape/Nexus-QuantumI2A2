from __future__ import annotations

from app.services import nlp_service


def test_extract_entities_basic() -> None:
    text = "1234 Produto teste 10,00"
    result = nlp_service.extract_entities(text)
    assert result[0]["sku"] == "1234"
    assert result[0]["total_value"] == 10.0
