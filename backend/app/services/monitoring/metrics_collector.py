"""Runtime metrics collector with adaptive EfficiencyGuard integration."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from threading import Lock
from typing import Dict, Iterable, Mapping, MutableMapping, Optional, Sequence

from ...config import EfficiencyThreshold, get_settings


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_metadata(payload: Mapping[str, object]) -> Dict[str, object]:
    normalized: Dict[str, object] = {}
    for key, value in payload.items():
        if isinstance(value, (str, int, float, bool)) or value is None:
            normalized[key] = value
        else:  # pragma: no cover - defensive path for unexpected payloads
            normalized[key] = repr(value)
    return normalized


@dataclass(slots=True)
class MetricSummary:
    """Aggregated metric information for a given agent scope."""

    agent: str
    total_latency_ms: float = 0.0
    executions: int = 0
    successes: int = 0
    errors: int = 0
    throughput: int = 0
    retries: int = 0
    last_latency_ms: Optional[float] = None
    last_updated: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    metadata: MutableMapping[str, object] = field(default_factory=dict)

    def record(
        self,
        duration_ms: float,
        success: bool,
        retries: int,
        metadata: Optional[Mapping[str, object]] = None,
    ) -> None:
        self.total_latency_ms += duration_ms
        self.executions += 1
        self.throughput += 1
        if success:
            self.successes += 1
        else:
            self.errors += 1
        self.retries = max(self.retries, retries)
        self.last_latency_ms = duration_ms
        self.last_updated = datetime.now(timezone.utc)
        if metadata:
            self.metadata.update(_normalize_metadata(metadata))

    @property
    def average_latency_ms(self) -> Optional[float]:
        if self.executions == 0:
            return None
        return self.total_latency_ms / self.executions

    @property
    def error_rate(self) -> float:
        total = self.successes + self.errors
        if total == 0:
            return 0.0
        return self.errors / total

    def to_dict(self) -> Dict[str, object]:
        return {
            "agent": self.agent,
            "average_latency_ms": self.average_latency_ms,
            "last_latency_ms": self.last_latency_ms,
            "throughput": self.throughput,
            "executions": self.executions,
            "successes": self.successes,
            "errors": self.errors,
            "error_rate": self.error_rate,
            "retries": self.retries,
            "last_updated": self.last_updated.isoformat(),
            "metadata": dict(self.metadata),
        }


@dataclass(slots=True)
class AdjustmentDecision:
    """Represents an automatic adjustment enforced by the EfficiencyGuard."""

    action: str
    reason: str
    parameters: MutableMapping[str, object] = field(default_factory=dict)
    triggered_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def to_dict(self) -> Dict[str, object]:
        return {
            "action": self.action,
            "reason": self.reason,
            "parameters": dict(self.parameters),
            "triggered_at": self.triggered_at.isoformat(),
        }


class EfficiencyGuard:
    """Applies adaptive tuning decisions when metrics breach configured thresholds."""

    def __init__(
        self,
        thresholds: Mapping[str, Mapping[str, float]],
        max_timeout_ms: int,
        timeout_step_ms: int,
    ) -> None:
        self._thresholds: Dict[str, Dict[str, float]] = {
            scope: dict(values) for scope, values in thresholds.items()
        }
        self._max_timeout_ms = max_timeout_ms
        self._timeout_step_ms = timeout_step_ms
        self._last_signatures: Dict[str, Dict[str, tuple]] = {}

    def _threshold_for(self, scope: str) -> Optional[Dict[str, float]]:
        return self._thresholds.get(scope) or self._thresholds.get("default")

    def update_thresholds(
        self,
        thresholds: Mapping[str, EfficiencyThreshold | Mapping[str, float]],
    ) -> None:
        for scope, config in thresholds.items():
            if isinstance(config, EfficiencyThreshold):
                self._thresholds[scope] = {
                    "latency_ms": config.latency_ms,
                    "error_rate": config.error_rate,
                    "throughput_min": config.throughput_min,
                    "consecutive_retries": config.consecutive_retries,
                }
            else:
                self._thresholds[scope] = dict(config)

    def update_timeouts(self, *, max_timeout_ms: int, timeout_step_ms: int) -> None:
        self._max_timeout_ms = max_timeout_ms
        self._timeout_step_ms = timeout_step_ms

    def _register_decision(self, scope: str, action: str, signature: tuple) -> bool:
        state = self._last_signatures.setdefault(scope, {})
        if state.get(action) == signature:
            return False
        state[action] = signature
        return True

    def _compute_timeout(self, current_timeout: Optional[int]) -> Optional[int]:
        baseline = current_timeout or 0
        proposed = min(baseline + self._timeout_step_ms, self._max_timeout_ms)
        if proposed <= baseline:
            return None
        return proposed

    def evaluate(
        self,
        scope: str,
        summary: MetricSummary,
        *,
        current_timeout_ms: Optional[int] = None,
    ) -> Sequence[AdjustmentDecision]:
        thresholds = self._threshold_for(scope)
        if not thresholds:
            return []

        decisions: list[AdjustmentDecision] = []
        avg_latency = summary.average_latency_ms or 0.0
        error_rate = summary.error_rate
        throughput = summary.throughput
        retries = summary.retries
        now = datetime.now(timezone.utc)

        latency_threshold = thresholds.get("latency_ms")
        if latency_threshold and avg_latency > latency_threshold:
            timeout_candidate = self._compute_timeout(current_timeout_ms)
            if timeout_candidate and self._register_decision(
                scope,
                "update_timeout",
                (timeout_candidate,),
            ):
                decisions.append(
                    AdjustmentDecision(
                        action="update_timeout",
                        reason=
                        f"Latência média {avg_latency:.1f}ms excedeu o limite de {latency_threshold:.0f}ms.",
                        parameters={
                            "timeout_ms": timeout_candidate,
                            "observed_latency_ms": round(avg_latency, 2),
                        },
                        triggered_at=now,
                    )
                )

        error_threshold = thresholds.get("error_rate")
        if error_threshold is not None and error_rate > error_threshold and self._register_decision(
            scope,
            "enable_recovery_mode",
            (round(error_rate, 4),),
        ):
            decisions.append(
                AdjustmentDecision(
                    action="enable_recovery_mode",
                    reason=
                    f"Taxa de erro {error_rate:.2%} excedeu o limite de {error_threshold:.2%}.",
                    parameters={"enabled": True, "error_rate": round(error_rate, 4)},
                    triggered_at=now,
                )
            )

        throughput_min = thresholds.get("throughput_min")
        if throughput_min is not None and throughput < throughput_min and self._register_decision(
            scope,
            "increase_batch_size",
            (throughput,),
        ):
            decisions.append(
                AdjustmentDecision(
                    action="increase_batch_size",
                    reason=
                    f"Throughput {throughput} abaixo do mínimo configurado ({throughput_min}).",
                    parameters={"multiplier": 1.25, "current_throughput": throughput},
                    triggered_at=now,
                )
            )

        retry_threshold = thresholds.get("consecutive_retries")
        if retry_threshold is not None and retries >= retry_threshold and self._register_decision(
            scope,
            "escalate_retries",
            (retries,),
        ):
            decisions.append(
                AdjustmentDecision(
                    action="escalate_retries",
                    reason=
                    f"Número de retries consecutivos ({retries}) atingiu o limite de {retry_threshold}.",
                    parameters={"retries": retries},
                    triggered_at=now,
                )
            )

        return decisions


class MetricsCollector:
    """In-memory store for runtime metrics consumed by dashboards and reports."""

    def __init__(self, guard: Optional[EfficiencyGuard] = None) -> None:
        self._guard = guard
        self._lock = Lock()
        self._metrics: Dict[str, MetricSummary] = {}
        self._adjustments: Dict[str, list[AdjustmentDecision]] = {}

    def record_execution(
        self,
        agent: str,
        *,
        duration_ms: float,
        success: bool,
        retries: int = 0,
        metadata: Optional[Mapping[str, object]] = None,
    ) -> Sequence[AdjustmentDecision]:
        with self._lock:
            summary = self._metrics.setdefault(agent, MetricSummary(agent=agent))
            summary.record(duration_ms, success, retries, metadata)

            decisions: Sequence[AdjustmentDecision] = []
            if self._guard:
                timeout_ms = None
                if metadata and "timeout_ms" in metadata:
                    try:
                        timeout_ms = int(metadata["timeout_ms"])  # type: ignore[arg-type]
                    except (TypeError, ValueError):  # pragma: no cover - defensive
                        timeout_ms = None
                decisions = self._guard.evaluate(
                    agent,
                    summary,
                    current_timeout_ms=timeout_ms,
                )
                if decisions:
                    self._adjustments[agent] = list(decisions)
            return list(decisions)

    def get_snapshot(self) -> Dict[str, Dict[str, object]]:
        with self._lock:
            return {agent: summary.to_dict() for agent, summary in self._metrics.items()}

    def get_adjustments(self) -> Dict[str, Iterable[Dict[str, object]]]:
        with self._lock:
            return {
                agent: [decision.to_dict() for decision in decisions]
                for agent, decisions in self._adjustments.items()
            }

    def export_payload(self) -> Dict[str, object]:
        with self._lock:
            snapshot = {agent: summary.to_dict() for agent, summary in self._metrics.items()}
            adjustments = {
                agent: [decision.to_dict() for decision in decisions]
                for agent, decisions in self._adjustments.items()
            }
        return {
            "generated_at": _iso_now(),
            "metrics": snapshot,
            "adjustments": adjustments,
        }


def _build_metrics_collector() -> MetricsCollector:
    default_thresholds: Dict[str, Dict[str, float]] = {
        "default": {
            "latency_ms": 2_500.0,
            "error_rate": 0.15,
            "throughput_min": 1.0,
            "consecutive_retries": 3,
        }
    }
    guard_enabled = True
    max_timeout_ms = 180_000
    timeout_step_ms = 1_000

    try:
        settings = get_settings()
    except Exception:  # pragma: no cover - environments without full settings
        guard = EfficiencyGuard(default_thresholds, max_timeout_ms, timeout_step_ms)
        return MetricsCollector(guard if guard_enabled else None)

    guard_enabled = settings.efficiency_guard_enabled
    max_timeout_ms = settings.efficiency_guard_max_timeout_ms
    timeout_step_ms = settings.efficiency_guard_timeout_step_ms

    thresholds: Dict[str, Dict[str, float]] = {
        scope: {
            "latency_ms": config.latency_ms,
            "error_rate": config.error_rate,
            "throughput_min": config.throughput_min,
            "consecutive_retries": config.consecutive_retries,
        }
        for scope, config in settings.efficiency_thresholds.items()
    }
    guard = EfficiencyGuard(thresholds, max_timeout_ms, timeout_step_ms)
    return MetricsCollector(guard if guard_enabled else None)


metrics_collector = _build_metrics_collector()

