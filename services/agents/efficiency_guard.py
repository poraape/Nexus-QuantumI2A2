"""Guard agent that monitors latency and token usage for orchestrated agents."""
from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Mapping, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from services.orchestrator.async_controller import AsyncAgentController


@dataclass(slots=True)
class GuardMetric:
    agent: str
    latency_ms: Optional[float]
    tokens: Optional[int]
    stage: Optional[str]
    timestamp: float


@dataclass(slots=True)
class GuardAlert:
    agent: str
    reason: str
    latency_ms: Optional[float]
    tokens: Optional[int]
    stage: Optional[str]
    timestamp: float


class EfficiencyGuardAgent:
    """Simple watchdog that enforces latency/token budgets via hooks."""

    name = "efficiency_guard"

    def __init__(
        self,
        *,
        max_tokens_per_call: int = 12_000,
        max_latency_ms: float = 2_500.0,
        alert_handler: Optional[Callable[[GuardAlert], None]] = None,
    ) -> None:
        self.max_tokens_per_call = max_tokens_per_call
        self.max_latency_ms = max_latency_ms
        self._alert_handler = alert_handler

        self._lock = asyncio.Lock()
        self._pending: Dict[str, float] = {}
        self.metrics: List[GuardMetric] = []
        self.alerts: List[GuardAlert] = []

    def attach(self, controller: "AsyncAgentController") -> None:
        controller.register_before_hook(self._on_before)
        controller.register_after_hook(self._on_after)

    async def _on_before(self, agent: str, context: Mapping[str, Any]) -> None:
        async with self._lock:
            self._pending[agent] = time.perf_counter()

    async def _on_after(self, agent: str, context: Mapping[str, Any]) -> None:
        tokens = context.get("tokens")
        latency_ms = context.get("latency_ms")
        stage = context.get("stage")

        start_time: Optional[float]
        async with self._lock:
            start_time = self._pending.pop(agent, None)

        if latency_ms is None and start_time is not None:
            latency_ms = (time.perf_counter() - start_time) * 1000

        metric = GuardMetric(
            agent=agent,
            latency_ms=float(latency_ms) if latency_ms is not None else None,
            tokens=int(tokens) if isinstance(tokens, int) else None,
            stage=stage if isinstance(stage, str) else None,
            timestamp=time.time(),
        )

        alert: Optional[GuardAlert] = None
        if metric.tokens is not None and metric.tokens > self.max_tokens_per_call:
            alert = GuardAlert(
                agent=agent,
                reason="tokens_budget_exceeded",
                latency_ms=metric.latency_ms,
                tokens=metric.tokens,
                stage=metric.stage,
                timestamp=metric.timestamp,
            )
        if metric.latency_ms is not None and metric.latency_ms > self.max_latency_ms:
            alert = GuardAlert(
                agent=agent,
                reason="latency_budget_exceeded",
                latency_ms=metric.latency_ms,
                tokens=metric.tokens,
                stage=metric.stage,
                timestamp=metric.timestamp,
            )

        callback: Optional[Callable[[GuardAlert], None]] = None
        async with self._lock:
            self.metrics.append(metric)
            if alert is not None:
                self.alerts.append(alert)
                callback = self._alert_handler

        if alert is not None and callback is not None:
            callback(alert)

    async def reset(self) -> None:
        async with self._lock:
            self._pending.clear()
            self.metrics.clear()
            self.alerts.clear()

    def latest_metrics(self, limit: int = 20) -> List[GuardMetric]:
        return self.metrics[-limit:]

    def latest_alerts(self, limit: int = 20) -> List[GuardAlert]:
        return self.alerts[-limit:]
