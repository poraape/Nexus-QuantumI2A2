"""Base para agentes com métricas simples."""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any, Callable

from tenacity import retry, stop_after_attempt, wait_exponential_jitter

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

    def run(self, *args: Any, **kwargs: Any) -> Any:  # pragma: no cover - interface
        raise NotImplementedError

    def _execute_with_metrics(self, func: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
        start = time.perf_counter()
        try:
            result = func(*args, **kwargs)
            return result
        except Exception:  # noqa: BLE001
            self.metrics.errors += 1
            raise
        finally:
            elapsed_ms = (time.perf_counter() - start) * 1000
            self.metrics.latency_ms = elapsed_ms
            self.metrics.throughput += 1


def retryable(fn: Callable[..., Any]) -> Callable[..., Any]:
    @retry(stop=stop_after_attempt(3), wait=wait_exponential_jitter(initial=0.5, exp_base=2))
    def wrapper(*args: Any, **kwargs: Any):
        return fn(*args, **kwargs)

    return wrapper
