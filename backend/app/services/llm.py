from __future__ import annotations

import json
import logging
from typing import Any, Dict, Optional

import httpx

from ..config import get_settings
from .audit import AuditLogger
from .crypto import SecretVault

logger = logging.getLogger(__name__)


class LLMClient:
    def __init__(self, vault: SecretVault, audit_logger: AuditLogger) -> None:
        self.settings = get_settings()
        self.vault = vault
        self.audit_logger = audit_logger

    async def _call_llm(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        api_key = self.vault.get_secret(self.settings.gemini_api_key_name)
        if not api_key:
            raise RuntimeError("Gemini API key not configured in secret vault.")

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        }
        endpoint = self.settings.llm_endpoint or "https://generativelanguage.googleapis.com/v1beta/models"
        model = payload.pop("model", self.settings.llm_model)
        url = f"{endpoint}/{model}:generateContent"
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(url, json=payload, headers=headers)
            response.raise_for_status()
            return response.json()

    async def generate_structured_response(
        self,
        prompt: str,
        schema: Dict[str, Any],
        model: Optional[str] = None,
    ) -> Dict[str, Any]:
        request_payload = {
            "model": model or self.settings.llm_model,
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {
                "responseMimeType": "application/json",
                "responseSchema": schema,
            },
        }
        raw_response = await self._call_llm(request_payload)
        self.audit_logger.log("llm_service", "llm.generate", {"model": model or self.settings.llm_model})
        candidates = raw_response.get("candidates") or []
        if not candidates:
            raise RuntimeError("LLM response did not include candidates.")
        content = candidates[0].get("content", {})
        parts = content.get("parts", [])
        if not parts:
            raise RuntimeError("LLM response missing parts.")
        text = parts[0].get("text")
        if not text:
            raise RuntimeError("LLM response missing text content.")
        return json.loads(text)

    async def generate_chat_response(
        self,
        session_id: str,
        history: list[Dict[str, str]],
        message: str,
        schema: Dict[str, Any],
        system_instruction: str,
        model: Optional[str] = None,
    ) -> Dict[str, Any]:
        prompt_parts = [{"text": system_instruction}]
        for item in history:
            prompt_parts.append({"text": f"{item['role']}: {item['content']}"})
        prompt_parts.append({"text": f"user: {message}"})
        request_payload = {
            "model": model or self.settings.llm_model,
            "contents": [{"role": "user", "parts": prompt_parts}],
            "generationConfig": {
                "responseMimeType": "application/json",
                "responseSchema": schema,
            },
        }
        raw_response = await self._call_llm(request_payload)
        self.audit_logger.log("llm_service", "llm.chat", {"session_id": session_id})
        candidates = raw_response.get("candidates") or []
        if not candidates:
            raise RuntimeError("LLM response did not include candidates.")
        content = candidates[0].get("content", {})
        parts = content.get("parts", [])
        if not parts:
            raise RuntimeError("LLM chat response missing parts.")
        text = parts[0].get("text")
        if not text:
            raise RuntimeError("LLM chat response missing text.")
        return json.loads(text)
