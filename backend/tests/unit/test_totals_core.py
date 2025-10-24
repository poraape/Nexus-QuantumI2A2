from __future__ import annotations

from app.core.totals import (
    ensure_document_totals,
    recompute_document_totals,
    to_float,
    totals_as_dict,
)


def test_to_float_converts_brl_strings() -> None:
    assert to_float("R$ 1.234,56") == 1234.56
    assert to_float("2.345,00") == 2345.0
    assert to_float("1234.78") == 1234.78


def test_recompute_document_totals_dict_payload() -> None:
    payload = {
        "document_id": "doc-01",
        "items": [
            {"total_value": "100,00", "taxes": {"ICMS": "10,00"}},
            {"valorTotalProduto": "50.00", "taxes": {"ICMS": "5,00"}},
        ],
        "totals": {"items_total": 0, "taxes_total": 0, "grand_total": 0},
    }
    totals = recompute_document_totals(payload)
    assert totals.items_total == 150.0
    assert totals.taxes_total == 15.0
    assert totals.grand_total == 165.0


def test_ensure_document_totals_overrides_zero_values() -> None:
    payload = {
        "document_id": "doc-02",
        "items": [
            {"total_value": "200,00"},
            {"total_value": "300,00"},
        ],
        "totals": {"items_total": 0, "taxes_total": 0, "grand_total": 0},
    }
    ensure_document_totals(payload)
    totals = totals_as_dict(payload["totals"])
    assert totals["items_total"] == 500.0
    assert totals["grand_total"] == 500.0
