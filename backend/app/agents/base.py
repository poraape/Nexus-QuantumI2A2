"""Base para agentes com métricas simples."""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any, Callable, Sequence

from tenacity import retry, stop_after_attempt, wait_exponential_jitter

from app.services.monitoring.metrics_collector import AdjustmentDecision, metrics_collector

logger = logging.getLogger(__name__)


@dataclass
class AgentMetrics:
    latency_ms: float = 0.0
    retries: int = 0
    errors: int = 0
    throughput: int = 0


class Agent:
    name: str = "agent"
    timeout_ms: int = 120_000
    metrics: AgentMetrics

    def __init__(self) -> None:
        self.metrics = AgentMetrics()
        self.recovery_mode = False
        self.batch_size_hint = 1
        self._last_adjustments: list[AdjustmentDecision] = []

    def run(self, *args: Any, **kwargs: Any) -> Any:  # pragma: no cover - interface
        raise NotImplementedError

    def _execute_with_metrics(self, func: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
        start = time.perf_counter()
        success = False
        try:
            result = func(*args, **kwargs)
            success = True
            return result
        except Exception:  # noqa: BLE001
            self.metrics.errors += 1
            raise
        finally:
            elapsed_ms = (time.perf_counter() - start) * 1000
            self.metrics.latency_ms = elapsed_ms
            self.metrics.throughput += 1
            decisions = metrics_collector.record_execution(
                self.name,
                duration_ms=elapsed_ms,
                success=success,
                retries=self.metrics.retries,
                metadata={
                    "timeout_ms": self.timeout_ms,
                    "errors": self.metrics.errors,
                    "throughput": self.metrics.throughput,
                },
            )
            if decisions:
                self._apply_adjustments(decisions)

    def _apply_adjustments(self, decisions: Sequence[AdjustmentDecision]) -> None:
        for decision in decisions:
            logger.info(
                "Aplicando ajuste automático",
                extra={
                    "agent": self.name,
                    "action": decision.action,
                    "reason": decision.reason,
                    "parameters": decision.parameters,
                },
            )
            if decision.action == "update_timeout":
                timeout = decision.parameters.get("timeout_ms")
                if isinstance(timeout, (int, float)) and timeout > 0:
                    self.timeout_ms = int(timeout)
            elif decision.action == "enable_recovery_mode":
                enabled = decision.parameters.get("enabled", True)
                self.recovery_mode = bool(enabled)
            elif decision.action == "increase_batch_size":
                multiplier = decision.parameters.get("multiplier", 1.0)
                try:
                    multiplier_value = float(multiplier)
                except (TypeError, ValueError):  # pragma: no cover - defensive
                    multiplier_value = 1.0
                self.batch_size_hint = max(1, int(round(self.batch_size_hint * multiplier_value)))
            elif decision.action == "escalate_retries":
                retries = decision.parameters.get("retries")
                if isinstance(retries, int) and retries > self.metrics.retries:
                    self.metrics.retries = retries
        self._last_adjustments = list(decisions)


def retryable(fn: Callable[..., Any]) -> Callable[..., Any]:
    @retry(stop=stop_after_attempt(3), wait=wait_exponential_jitter(initial=0.5, exp_base=2))
    def wrapper(*args: Any, **kwargs: Any):
        return fn(*args, **kwargs)

    return wrapper
