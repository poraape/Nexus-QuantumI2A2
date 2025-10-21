"""Serviço NLP simplificado."""
from __future__ import annotations

import re
from typing import Any


def extract_entities(text: str) -> list[dict[str, Any]]:
    pattern = re.compile(r"(?P<sku>\d{4,})\s+(?P<description>.+?)\s+(?P<total>\d+[.,]\d{2})")
    items: list[dict[str, Any]] = []
    for match in pattern.finditer(text):
        total = float(match.group("total").replace(".", "").replace(",", "."))
        items.append(
            {
                "sku": match.group("sku"),
                "description": match.group("description").strip(),
                "quantity": 1.0,
                "unit_price": total,
                "total_value": total,
            }
        )
    return items
