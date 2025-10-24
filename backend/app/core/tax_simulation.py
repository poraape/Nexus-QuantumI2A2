from __future__ import annotations

from typing import Dict, Iterable, MutableMapping, Optional, Union

from app.core.tax_rules import get_icms_rate
from app.core.totals import to_float
from app.schemas import Document, DocumentItem

DocumentLike = Union[Document, MutableMapping[str, object]]


def _iter_items(document: DocumentLike) -> Iterable[DocumentItem]:
    if isinstance(document, Document):
        return document.items
    return document.get("items", []) if isinstance(document, MutableMapping) else []  # type: ignore[index]


def _get_metadata(document: DocumentLike) -> MutableMapping[str, object]:
    if isinstance(document, Document):
        if document.metadata is None:
            document.metadata = {}
        return document.metadata
    if isinstance(document, MutableMapping):
        metadata = document.setdefault("metadata", {})
        if not isinstance(metadata, MutableMapping):
            metadata = {}
            document["metadata"] = metadata
        return metadata  # type: ignore[return-value]
    return {}


def simulate_icms_scenarios(
    document: DocumentLike,
    *,
    overrides: Optional[Dict[str, float]] = None,
) -> DocumentLike:
    metadata = _get_metadata(document)

    origem = str(metadata.get("origem_uf") or metadata.get("emitente_uf") or metadata.get("uf_origem") or "SP").upper()
    destino = str(metadata.get("destino_uf") or metadata.get("destinatario_uf") or metadata.get("uf_destino") or "SP").upper()

    items = list(_iter_items(document))
    base_total = sum(to_float(getattr(item, "total_value", 0) if isinstance(item, DocumentItem) else item.get("total_value")) for item in items)  # type: ignore[union-attr]

    if base_total <= 0:
        metadata["what_if_icms"] = {}
        return document

    state_overrides: Dict[str, float] = overrides or {}
    destination_rates: Dict[str, float] = {}

    states: set[str] = {origem, destino}
    states.update(state_overrides.keys())

    for item in items:
        if isinstance(item, DocumentItem):
            continue
        uf = item.get("uf") or item.get("destinatario_uf")
        if isinstance(uf, str):
            states.add(uf.upper())

    simulations: Dict[str, Dict[str, float]] = {}

    tuple_overrides = {(origem.upper(), uf.upper()): rate for uf, rate in state_overrides.items() if len(uf) == 2}

    for uf in sorted(states):
        rate = get_icms_rate(origem, uf, overrides=tuple_overrides, default_overrides=state_overrides)
        destination_rates[uf] = rate
        simulations[uf] = {
            "aliquota": rate,
            "base_calculo": round(base_total, 2),
            "icms_estimado": round(base_total * rate, 2),
        }

    metadata["what_if_icms"] = simulations
    metadata["icms_rates_applied"] = destination_rates

    return document
