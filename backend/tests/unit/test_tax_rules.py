from __future__ import annotations

from app.core.tax_rules import adjust_icms_by_uf, get_icms_rate


def test_adjust_icms_by_uf_known_route() -> None:
    value = adjust_icms_by_uf("SP", "RJ", 1000.0)
    assert value == 120.0


def test_adjust_icms_by_uf_default_rate() -> None:
    value = adjust_icms_by_uf("AM", "RR", 500.0)
    assert value == 90.0


def test_get_icms_rate_with_overrides() -> None:
    rate = get_icms_rate("SP", "RJ", overrides={("SP", "RJ"): 0.2})
    assert rate == 0.2


def test_adjust_icms_with_destination_override() -> None:
    value = adjust_icms_by_uf("SP", "BA", 1000.0, default_overrides={"BA": 0.15})
    assert value == 150.0
