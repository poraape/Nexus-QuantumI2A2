"""Cliente LLM com fallback."""
from __future__ import annotations

import json
import logging
from typing import Any

from tenacity import retry, stop_after_attempt, wait_exponential_jitter

logger = logging.getLogger(__name__)


class LLMService:
    def __init__(self, primary_model: str = "gemini", fallback_model: str | None = "openai") -> None:
        self.primary_model = primary_model
        self.fallback_model = fallback_model

    @retry(stop=stop_after_attempt(3), wait=wait_exponential_jitter(initial=0.5, exp_base=2))
    def run(self, prompt: str, schema: dict[str, Any] | None = None) -> dict[str, Any]:
        logger.info("Executando LLM %s", self.primary_model)
        try:
            response = self._fake_call(prompt, schema)
            return response
        except Exception as exc:  # noqa: BLE001
            logger.error("Falha no modelo primário: %s", exc)
            if self.fallback_model:
                logger.info("Tentando fallback %s", self.fallback_model)
                return self._fake_call(prompt, schema)
            raise

    def _fake_call(self, prompt: str, schema: dict[str, Any] | None) -> dict[str, Any]:
        data = {"prompt": prompt, "schema": schema or {}, "result": "ok"}
        return json.loads(json.dumps(data))


service = LLMService()
