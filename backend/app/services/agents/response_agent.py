"""Service that centralizes response generation parameters for agents."""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, Optional, Tuple

from ..llm_service import LLMService, service as llm_service

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class EfficiencyGuard:
    """Clamp generation parameters to keep inference cost under control."""

    max_temperature: float = 0.7
    min_temperature: float = 0.0
    max_output_tokens: int = 4096
    min_output_tokens: int = 16

    def clamp(self, temperature: float, max_output_tokens: int) -> Tuple[float, int]:
        """Return safe values for temperature and tokens respecting guardrails."""

        safe_temperature = max(self.min_temperature, min(temperature, self.max_temperature))
        safe_tokens = max(self.min_output_tokens, min(int(max_output_tokens), self.max_output_tokens))
        return safe_temperature, safe_tokens


@dataclass(slots=True)
class ResponseAgentService:
    """Central orchestration point for agent responses."""

    llm: LLMService
    default_model: str = "gemini-1.5-pro"
    default_temperature: float = 0.2
    default_max_output_tokens: int = 1024
    guard: EfficiencyGuard = field(default_factory=EfficiencyGuard)

    def build_generation_config(
        self,
        temperature: Optional[float] = None,
        max_output_tokens: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Produce a sanitized generation configuration for downstream LLM calls."""

        raw_temperature = self.default_temperature if temperature is None else temperature
        raw_tokens = self.default_max_output_tokens if max_output_tokens is None else max_output_tokens
        safe_temperature, safe_tokens = self.guard.clamp(raw_temperature, raw_tokens)
        return {
            "temperature": safe_temperature,
            "maxOutputTokens": safe_tokens,
            "candidateCount": 1,
        }

    def generate_structured_response(
        self,
        prompt: str,
        schema: Optional[Dict[str, Any]] = None,
        *,
        temperature: Optional[float] = None,
        max_output_tokens: Optional[int] = None,
        model: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Execute an LLM call with guard rails and centralized defaults."""

        generation_config = self.build_generation_config(temperature, max_output_tokens)
        active_model = model or self.default_model
        logger.info(
            "Invoking response agent",
            extra={
                "model": active_model,
                "generation_config": generation_config,
            },
        )
        return self.llm.run(
            prompt,
            schema or {},
            model=active_model,
            generation_config=generation_config,
        )


response_agent_service = ResponseAgentService(llm_service)

__all__ = ["EfficiencyGuard", "ResponseAgentService", "response_agent_service"]
