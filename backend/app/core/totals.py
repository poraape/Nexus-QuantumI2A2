from __future__ import annotations

import logging
import re
from decimal import Decimal
from typing import Any, Iterable, Mapping, MutableMapping, Union

from app.schemas import Document, DocumentItem, DocumentTotals

logger = logging.getLogger(__name__)

NumberLike = Union[str, int, float, Decimal, None]
DocumentLike = Union[Document, MutableMapping[str, Any]]


def to_float(value: NumberLike) -> float:
    """Convert Brazilian formatted numbers (R$ 1.234,56) or native values to float."""
    if value is None:
        return 0.0
    if isinstance(value, (int, float, Decimal)):
        return float(value)

    text = str(value).strip()
    if not text:
        return 0.0

    sanitized = re.sub(r"[^0-9,.\-]", "", text)
    if sanitized.count(",") and sanitized.count("."):
        last_comma = sanitized.rfind(",")
        last_dot = sanitized.rfind(".")
        if last_comma > last_dot:
            sanitized = sanitized.replace(".", "")
            sanitized = sanitized.replace(",", ".")
    elif sanitized.count(",") == 1 and sanitized.count(".") == 0:
        sanitized = sanitized.replace(",", ".")

    try:
        return float(sanitized)
    except ValueError:
        logger.debug("Could not convert value '%s' to float. Returning 0.0.", text)
        return 0.0


def _iter_items(document: DocumentLike) -> Iterable[Any]:
    if isinstance(document, Document):
        return document.items or []
    return (document.get("items") or [])  # type: ignore[attr-defined]


def _item_attribute(item: Any, attr: str) -> Any:
    if hasattr(item, attr):
        return getattr(item, attr)
    if isinstance(item, Mapping):
        return item.get(attr)
    return None


def _item_total(item: Any) -> float:
    value = _item_attribute(item, "total_value")
    if value is None and isinstance(item, Mapping):
        value = (
            item.get("valorTotalProduto")
            or item.get("vProd")
            or item.get("valor_total")
        )
    return max(to_float(value), 0.0)


def _item_taxes(item: Any) -> float:
    taxes = _item_attribute(item, "taxes")
    if taxes is None and isinstance(item, Mapping):
        taxes = item.get("impostos") or {}
    if isinstance(taxes, Mapping):
        total = 0.0
        for tax_value in taxes.values():
            if isinstance(tax_value, Mapping):
                total += to_float(tax_value.get("value") or tax_value.get("v"))
            else:
                total += to_float(tax_value)
        return max(total, 0.0)
    return 0.0


def totals_as_dict(totals: Any) -> MutableMapping[str, float]:
    if isinstance(totals, DocumentTotals):
        return totals.model_dump()
    if isinstance(totals, Mapping):
        return {
            "items_total": to_float(totals.get("items_total") or totals.get("products")),
            "taxes_total": to_float(totals.get("taxes_total") or totals.get("taxes")),
            "grand_total": to_float(totals.get("grand_total") or totals.get("total")),
        }
    return {"items_total": 0.0, "taxes_total": 0.0, "grand_total": 0.0}


def recompute_document_totals(document: DocumentLike) -> DocumentTotals:
    items_total = 0.0
    taxes_total = 0.0

    for item in _iter_items(document):
        items_total += _item_total(item)
        taxes_total += _item_taxes(item)

    items_total = max(items_total, 0.0)
    taxes_total = max(taxes_total, 0.0)
    grand_total = max(items_total + taxes_total, 0.0)

    return DocumentTotals(
        items_total=items_total,
        taxes_total=taxes_total,
        grand_total=grand_total,
    )


def ensure_document_totals(document: DocumentLike) -> DocumentLike:
    """Ensure a document (pydantic or dict) has consistent totals."""
    existing_totals = totals_as_dict(
        document.totals if isinstance(document, Document) else document.get("totals")
    )
    recalculated = totals_as_dict(recompute_document_totals(document))

    merged_totals = existing_totals or recalculated
    for key, value in recalculated.items():
        if to_float(merged_totals.get(key)) == 0.0:
            merged_totals[key] = value

    totals_object = DocumentTotals(**merged_totals)

    if isinstance(document, Document):
        document.totals = totals_object
    else:
        document["totals"] = totals_object.model_dump()

    return document
