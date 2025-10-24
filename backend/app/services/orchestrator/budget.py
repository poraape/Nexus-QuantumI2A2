"""Token budget accounting utilities for orchestrator agents."""
from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass
from typing import Dict, Iterable, Mapping, MutableMapping, Optional, Tuple

from app.config import get_settings


@dataclass(frozen=True)
class BudgetViolation:
    """Represents a pre-flight validation failure."""

    scope: str
    identifier: str
    limit: int
    requested: int


class TokenBudgetExceeded(RuntimeError):
    """Raised when a token reservation would exceed configured limits."""

    def __init__(self, agent: str, step: str, *, limit: int, requested: int) -> None:
        message = (
            "Token budget exceeded for %(agent)s/%(step)s: requested %(requested)d, limit %(limit)d"
            % {"agent": agent, "step": step, "requested": requested, "limit": limit}
        )
        super().__init__(message)
        self.agent = agent
        self.step = step
        self.limit = limit
        self.requested = requested


class TokenBudgetManager:
    """Tracks token consumption with agent and stage limits."""

    DEFAULT_STAGE_WEIGHTS: Dict[Tuple[str, str], float] = {
        ("ocr", "ingest"): 1.0,
        ("auditor", "analysis"): 0.7,
        ("classifier", "classification"): 0.5,
        ("accountant", "reconciliation"): 0.4,
        ("crossValidator", "consistency"): 0.35,
        ("intelligence", "analysis"): 0.9,
    }

    def __init__(
        self,
        total_limit: int,
        agent_limits: Mapping[str, int],
        step_limits: Mapping[str, Mapping[str, int]] | None = None,
        *,
        stage_weights: Mapping[Tuple[str, str], float] | None = None,
    ) -> None:
        self.total_limit = int(total_limit)
        self.agent_limits = {key: int(value) for key, value in agent_limits.items()}
        self.step_limits = {
            agent: {step: int(limit) for step, limit in steps.items()}
            for agent, steps in (step_limits or {}).items()
        }
        self.stage_weights: Dict[Tuple[str, str], float] = {
            **self.DEFAULT_STAGE_WEIGHTS,
            **(stage_weights or {}),
        }

        self._consumed_total = 0
        self._consumed_per_agent: MutableMapping[str, int] = defaultdict(int)
        self._consumed_per_step: MutableMapping[Tuple[str, str], int] = defaultdict(int)

    # ------------------------------------------------------------------
    # Construction helpers
    # ------------------------------------------------------------------
    @classmethod
    def from_settings(cls) -> "TokenBudgetManager":
        settings = get_settings()
        return cls(
            settings.token_budget_total,
            settings.token_budget_per_agent,
            settings.token_budget_per_step,
        )

    @classmethod
    def from_context(cls, payload: Mapping[str, object] | None) -> "TokenBudgetManager":
        if not isinstance(payload, Mapping):
            return cls.from_settings()
        total_limit = int(payload.get("total", 0) or 0)
        agent_limits = {
            key: int(value)
            for key, value in (payload.get("perAgent") if isinstance(payload.get("perAgent"), Mapping) else {}).items()
        }
        step_raw = payload.get("perStep")
        step_limits: Dict[str, Dict[str, int]] = {}
        if isinstance(step_raw, Mapping):
            for agent, steps in step_raw.items():
                if isinstance(steps, Mapping):
                    step_limits[agent] = {step: int(limit) for step, limit in steps.items()}
        if total_limit <= 0 and not agent_limits and not step_limits:
            return cls.from_settings()
        if total_limit <= 0:
            total_limit = get_settings().token_budget_total
        return cls(
            total_limit,
            agent_limits or get_settings().token_budget_per_agent,
            step_limits or get_settings().token_budget_per_step,
        )

    # ------------------------------------------------------------------
    # Budget calculations
    # ------------------------------------------------------------------
    def remaining_total(self) -> Optional[int]:
        if self.total_limit <= 0:
            return None
        return max(self.total_limit - self._consumed_total, 0)

    def remaining_for_agent(self, agent: str) -> Optional[int]:
        limit = self.agent_limits.get(agent)
        if not limit:
            return None
        consumed = self._consumed_per_agent.get(agent, 0)
        return max(limit - consumed, 0)

    def remaining_for_step(self, agent: str, step: str) -> Optional[int]:
        limit = self.step_limits.get(agent, {}).get(step)
        if not limit:
            return self.remaining_for_agent(agent)
        consumed = self._consumed_per_step.get((agent, step), 0)
        return max(limit - consumed, 0)

    def _ensure_can_consume(self, agent: str, step: str, tokens: int) -> None:
        total_after = self._consumed_total + tokens
        if self.total_limit > 0 and total_after > self.total_limit:
            raise TokenBudgetExceeded(agent, step, limit=self.total_limit, requested=total_after)

        agent_limit = self.agent_limits.get(agent)
        if agent_limit and self._consumed_per_agent[agent] + tokens > agent_limit:
            raise TokenBudgetExceeded(agent, step, limit=agent_limit, requested=self._consumed_per_agent[agent] + tokens)

        step_limit = self.step_limits.get(agent, {}).get(step)
        if step_limit and self._consumed_per_step[(agent, step)] + tokens > step_limit:
            raise TokenBudgetExceeded(agent, step, limit=step_limit, requested=self._consumed_per_step[(agent, step)] + tokens)

    def consume(self, agent: str, step: str, tokens: int) -> None:
        tokens = int(tokens)
        if tokens <= 0:
            return
        self._ensure_can_consume(agent, step, tokens)
        self._consumed_total += tokens
        self._consumed_per_agent[agent] += tokens
        self._consumed_per_step[(agent, step)] += tokens

    # ------------------------------------------------------------------
    # Estimation utilities
    # ------------------------------------------------------------------
    @staticmethod
    def estimate_tokens_from_metadata(
        metadata: Mapping[str, object] | None,
        *,
        multiplier: float = 1.0,
        default_tokens: int = 512,
    ) -> int:
        if isinstance(metadata, Mapping):
            if metadata.get("token_estimate"):
                base = int(metadata["token_estimate"] or 0)
            elif metadata.get("size_bytes"):
                base = math.ceil(int(metadata["size_bytes"] or 0) / 4) or default_tokens
            elif metadata.get("char_count"):
                base = math.ceil(int(metadata["char_count"] or 0) / 4) or default_tokens
            else:
                base = default_tokens
        else:
            base = default_tokens
        estimate = max(1, int(math.ceil(base * max(multiplier, 0.1))))
        return estimate

    def consume_for_stage(
        self,
        agent: str,
        step: str,
        metadata: Mapping[str, object] | None,
        *,
        multiplier: float | None = None,
        tokens: Optional[int] = None,
    ) -> int:
        calculated = tokens if tokens is not None else self.estimate_tokens_from_metadata(
            metadata, multiplier=multiplier or self.stage_weights.get((agent, step), 1.0)
        )
        self.consume(agent, step, calculated)
        return calculated

    def snapshot(self) -> Dict[str, object]:
        return {
            "total": self.total_limit,
            "perAgent": dict(self.agent_limits),
            "perStep": {agent: dict(steps) for agent, steps in self.step_limits.items()},
        }

    # ------------------------------------------------------------------
    # Pre-flight validation helpers
    # ------------------------------------------------------------------
    def estimate_job_usage(self, files: Iterable[Mapping[str, object]]) -> Dict[str, object]:
        per_agent: MutableMapping[str, int] = defaultdict(int)
        per_step: MutableMapping[Tuple[str, str], int] = defaultdict(int)
        total = 0
        for file_info in files:
            metadata = file_info.get("metadata") if isinstance(file_info, Mapping) else None
            if isinstance(metadata, Mapping):
                size_bytes = metadata.get("size_bytes")
            else:
                size_bytes = file_info.get("size_bytes") if isinstance(file_info, Mapping) else None
            base_metadata = metadata if isinstance(metadata, Mapping) else {"size_bytes": size_bytes}
            for (agent, step), weight in self.stage_weights.items():
                tokens = self.estimate_tokens_from_metadata(base_metadata, multiplier=weight)
                per_agent[agent] += tokens
                per_step[(agent, step)] += tokens
                total += tokens
        return {
            "total": total,
            "per_agent": dict(per_agent),
            "per_step": {f"{agent}:{step}": tokens for (agent, step), tokens in per_step.items()},
        }

    def validate_preflight(self, usage: Mapping[str, object]) -> list[BudgetViolation]:
        violations: list[BudgetViolation] = []
        total_requested = int(usage.get("total") or 0)
        if self.total_limit > 0 and total_requested > self.total_limit:
            violations.append(
                BudgetViolation("total", "pipeline", self.total_limit, total_requested)
            )

        per_agent = usage.get("per_agent") if isinstance(usage.get("per_agent"), Mapping) else {}
        for agent, requested in per_agent.items():
            limit = self.agent_limits.get(agent)
            if limit and requested > limit:
                violations.append(BudgetViolation("agent", agent, limit, int(requested)))

        per_step = usage.get("per_step") if isinstance(usage.get("per_step"), Mapping) else {}
        for compound_key, requested in per_step.items():
            if not isinstance(compound_key, str):
                continue
            if ":" not in compound_key:
                continue
            agent, step = compound_key.split(":", 1)
            limit = self.step_limits.get(agent, {}).get(step)
            if limit and int(requested) > limit:
                violations.append(BudgetViolation("step", f"{agent}:{step}", limit, int(requested)))
        return violations


__all__ = [
    "TokenBudgetManager",
    "TokenBudgetExceeded",
    "BudgetViolation",
]
