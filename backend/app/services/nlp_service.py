"""Serviço NLP simplificado."""
from __future__ import annotations

import logging
import re
from typing import Any

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

def extract_entities(text: str) -> list[dict[str, Any]]:
    # Padrão mais flexível para diferentes formatos
    patterns = [
        # Formato comum: SKU + descrição + quantidade + valor unitário + valor total
        r"(?P<sku>\w+)\s+(?P<description>.*?)\s+(?P<quantity>\d+(?:[.,]\d+)?)\s+(?P<unit_price>(?:R\$\s*)?\d+(?:[.,]\d+)?)\s+(?P<total>(?:R\$\s*)?\d+(?:[.,]\d+)?)",
        # Formato alternativo: SKU + descrição + valor total
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
                    "total_value": total
                }

                # Validação básica dos valores
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
