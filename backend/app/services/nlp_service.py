"""Serviço NLP simplificado."""
from __future__ import annotations

import logging
import re
import xml.etree.ElementTree as ET
from typing import Any, List

logger = logging.getLogger(__name__)

def parse_monetary_value(value_str: str) -> float:
    """Converte string de valor monetário para float."""
    try:
        # Remove caracteres não numéricos exceto ponto e vírgula
        clean_value = re.sub(r"[^\d.,]", "", value_str)
        # Se tiver mais de um separador decimal, considera o último
        if clean_value.count(",") + clean_value.count(".") > 1:
            *_, last_part = re.split(r"[.,]", clean_value)
            main_part = "".join(re.split(r"[.,]", clean_value)[:-1])
            clean_value = f"{main_part}.{last_part}"
        # Normaliza para usar ponto como separador decimal
        if "," in clean_value and "." not in clean_value:
            clean_value = clean_value.replace(",", ".")
        elif "," in clean_value:
            clean_value = clean_value.replace(",", "")
        return float(clean_value)
    except (ValueError, IndexError) as e:
        logger.warning(f"Erro ao converter valor monetário '{value_str}': {e}")
        return 0.0

def _extract_from_xml(text: str) -> List[dict[str, Any]]:
    if "<" not in text:
        return []

    cleaned = re.sub(r"xmlns=\"[^\"]+\"", "", text)
    try:
        root = ET.fromstring(cleaned)
    except ET.ParseError:
        return []

    items: List[dict[str, Any]] = []
    for det in root.findall(".//det"):
        prod = det.find("prod")
        if prod is None:
            continue
        sku = (prod.findtext("cProd") or "").strip()
        description = (prod.findtext("xProd") or "").strip()
        quantity = parse_monetary_value(prod.findtext("qCom") or "1")
        unit_price = parse_monetary_value(prod.findtext("vUnCom") or prod.findtext("vProd") or "0")
        total_value = parse_monetary_value(prod.findtext("vProd") or prod.findtext("vUnCom") or "0")
        if total_value <= 0:
            continue
        items.append(
            {
                "sku": sku or None,
                "description": description,
                "quantity": quantity if quantity > 0 else 1.0,
                "unit_price": unit_price if unit_price > 0 else total_value,
                "total_value": total_value,
            }
        )
    return items


def extract_entities(text: str) -> list[dict[str, Any]]:
    xml_items = _extract_from_xml(text)
    if xml_items:
        return xml_items

    patterns = [
        r"(?P<sku>\w+)\s+(?P<description>.*?)\s+(?P<quantity>\d+(?:[.,]\d+)?)\s+(?P<unit_price>(?:R\$\s*)?\d+(?:[.,]\d+)?)\s+(?P<total>(?:R\$\s*)?\d+(?:[.,]\d+)?)",
        r"(?P<sku>\w+)\s+(?P<description>.*?)\s+(?P<total>(?:R\$\s*)?\d+(?:[.,]\d+)?)",
    ]

    items: list[dict[str, Any]] = []
    for pattern in patterns:
        matches = re.finditer(pattern, text, re.MULTILINE)
        for match in matches:
            try:
                total = parse_monetary_value(match.group("total"))
                item_data = {
                    "sku": match.group("sku"),
                    "description": match.group("description").strip(),
                    "quantity": float(match.group("quantity")) if "quantity" in match.groupdict() else 1.0,
                    "unit_price": parse_monetary_value(match.group("unit_price")) if "unit_price" in match.groupdict() else total,
                    "total_value": total,
                }

                if item_data["total_value"] <= 0:
                    logger.warning(f"Valor total inválido para SKU {item_data['sku']}: {total}")
                    continue

                items.append(item_data)
            except Exception as e:
                logger.error(f"Erro ao processar item: {e}")
                continue

    if not items:
        logger.warning("Nenhum item foi extraído do texto")

    return items
