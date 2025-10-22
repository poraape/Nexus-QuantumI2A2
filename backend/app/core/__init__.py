"""Core helpers for Nexus Quantum I2A2 backend."""

from .tax_rules import adjust_icms_by_uf, get_icms_rate
from .tax_simulation import simulate_icms_scenarios
from .totals import (
    ensure_document_totals,
    recompute_document_totals,
    to_float,
    totals_as_dict,
)

__all__ = [
    "adjust_icms_by_uf",
    "get_icms_rate",
    "simulate_icms_scenarios",
    "ensure_document_totals",
    "recompute_document_totals",
    "to_float",
    "totals_as_dict",
]
