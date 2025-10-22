from __future__ import annotations

from typing import Dict, Optional, Tuple

from app.core.totals import to_float

ICMS_TABLE: Dict[Tuple[str, str], float] = {
    ("SP", "RJ"): 0.12,
    ("SP", "MG"): 0.18,
    ("SP", "ES"): 0.12,
    ("RJ", "SP"): 0.12,
    ("RJ", "MG"): 0.18,
    ("MG", "SP"): 0.18,
    ("MG", "RJ"): 0.12,
    ("ES", "SP"): 0.12,
    ("ES", "MG"): 0.18,
    ("BA", "SP"): 0.12,
    ("BA", "RJ"): 0.12,
    ("PR", "SP"): 0.12,
}


def get_icms_rate(
    origem: str,
    destino: str,
    overrides: Optional[Dict[Tuple[str, str], float]] = None,
    default_overrides: Optional[Dict[str, float]] = None,
) -> float:
    origem_sigla = (origem or "").strip().upper() or "SP"
    destino_sigla = (destino or "").strip().upper() or "SP"
    key = (origem_sigla, destino_sigla)

    if overrides and key in overrides:
        return overrides[key]

    if default_overrides and destino_sigla in default_overrides:
        return default_overrides[destino_sigla]

    if overrides:
        for candidate_key in overrides:
            if candidate_key[0] == origem_sigla and candidate_key[1] == "*":
                return overrides[candidate_key]

    return ICMS_TABLE.get(key, default_overrides.get("*", 0.18) if default_overrides else 0.18)


def adjust_icms_by_uf(
    origem: str,
    destino: str,
    valor_base: float,
    overrides: Optional[Dict[Tuple[str, str], float]] = None,
    default_overrides: Optional[Dict[str, float]] = None,
) -> float:
    aliquota = get_icms_rate(origem, destino, overrides, default_overrides)
    return round(to_float(valor_base) * aliquota, 2)
