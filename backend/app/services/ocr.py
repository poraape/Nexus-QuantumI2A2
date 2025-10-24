from __future__ import annotations

import asyncio
from pathlib import Path

import pytesseract
from PIL import Image

from ..config import get_settings
from .audit import AuditLogger


class OCRService:
    def __init__(self, audit_logger: AuditLogger) -> None:
        self.settings = get_settings()
        self.audit_logger = audit_logger

    async def extract_text(self, image_path: Path) -> str:
        loop = asyncio.get_running_loop()
        language = self.settings.ocr_language
        text = await loop.run_in_executor(None, lambda: pytesseract.image_to_string(Image.open(image_path), lang=language))
        self.audit_logger.log("ocr_service", "ocr.extract", {"language": language})
        return text
