"""Serviço de OCR simplificado."""
from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger(__name__)


def extract_text_from_file(path: str) -> str:
    file_path = Path(path)
    if not file_path.exists():
        logger.warning("Arquivo %s não encontrado para OCR", path)
        return ""
    return file_path.read_text(encoding="utf-8", errors="ignore")
