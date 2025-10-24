"""Backend telemetry helpers for Celery agents."""
from __future__ import annotations

import importlib.util
import logging
from collections import defaultdict
from threading import Lock
from typing import DefaultDict, Dict, Iterable, Mapping, MutableMapping, Optional

from pydantic import ValidationError

_OTEL_AVAILABLE = importlib.util.find_spec("opentelemetry") is not None

if _OTEL_AVAILABLE:  # pragma: no cover - exercised in integration environments
    from opentelemetry import metrics
    from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
    from opentelemetry.sdk.metrics import MeterProvider
    from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.semconv.resource import ResourceAttributes
else:  # pragma: no cover - lightweight environments
    metrics = None  # type: ignore[assignment]
    OTLPMetricExporter = None  # type: ignore[assignment]
    MeterProvider = None  # type: ignore[assignment]
    PeriodicExportingMetricReader = None  # type: ignore[assignment]
    Resource = None  # type: ignore[assignment]
    ResourceAttributes = None  # type: ignore[assignment]

from .config import get_settings

logger = logging.getLogger(__name__)

MetricAttributes = MutableMapping[str, object]


def _parse_header_config(raw_headers: Optional[str]) -> Dict[str, str]:
    if not raw_headers:
        return {}
    pairs: Dict[str, str] = {}
    for entry in raw_headers.split(","):
        if not entry.strip():
            continue
        if "=" not in entry:
            continue
        key, value = entry.split("=", 1)
        pairs[key.strip()] = value.strip()
    return pairs


class TelemetryService:
    """Small facade around OpenTelemetry metrics primitives."""

    def __init__(self) -> None:
        self._lock = Lock()
        self._initialized = False
        self._disabled = False
        self._latency_histogram = None
        self._success_counter = None
        self._error_counter = None
        self._inconsistency_counter = None
        self._debug_metrics: DefaultDict[str, list[MetricAttributes]] = defaultdict(list)

    # Initialization -----------------------------------------------------
    def _ensure_initialized(self) -> None:
        if self._initialized:
            return
        with self._lock:
            if self._initialized:
                return

            try:
                settings = get_settings()
            except ValidationError:
                self._disabled = True
                self._initialized = True
                logger.warning(
                    "Telemetry disabled: incomplete settings detected during initialization",
                    exc_info=True,
                )
                return
            if not settings.telemetry_enabled or not _OTEL_AVAILABLE:
                self._disabled = True
                self._initialized = True
                return

            assert metrics is not None
            assert MeterProvider is not None
            assert PeriodicExportingMetricReader is not None
            assert Resource is not None
            assert ResourceAttributes is not None
            assert OTLPMetricExporter is not None

            resource = Resource.create(
                {
                    ResourceAttributes.SERVICE_NAME: settings.telemetry_service_name,
                    ResourceAttributes.DEPLOYMENT_ENVIRONMENT: settings.telemetry_environment,
                }
            )

            endpoint = settings.otel_exporter_otlp_endpoint.rstrip("/")
            exporter = OTLPMetricExporter(
                endpoint=f"{endpoint}/v1/metrics",
                headers=_parse_header_config(settings.otel_exporter_otlp_headers),
            )

            reader = PeriodicExportingMetricReader(
                exporter=exporter,
                export_interval_millis=settings.telemetry_export_interval_ms,
            )

            provider = MeterProvider(resource=resource, metric_readers=[reader])
            metrics.set_meter_provider(provider)
            meter = provider.get_meter(settings.telemetry_service_name)

            self._latency_histogram = meter.create_histogram(
                name="agent_latency_ms",
                unit="ms",
                description="Latência observada nas execuções dos agentes",
            )
            self._success_counter = meter.create_counter(
                name="agent_success_total",
                description="Total de execuções bem-sucedidas por agente",
            )
            self._error_counter = meter.create_counter(
                name="agent_error_total",
                description="Total de execuções com falha por agente",
            )
            self._inconsistency_counter = meter.create_counter(
                name="agent_inconsistencies_total",
                description="Total de inconsistências detectadas pelos agentes",
            )

            self._initialized = True

    # Metric helpers -----------------------------------------------------
    def _build_attributes(
        self, agent: str, operation: str, attributes: Optional[Mapping[str, object]] = None
    ) -> MetricAttributes:
        base: MetricAttributes = {
            "agent": agent,
            "operation": operation,
            "slo_target": "0.99",
        }
        if attributes:
            base.update(dict(attributes))
        return base

    def _record_debug(self, key: str, attributes: MetricAttributes) -> None:
        # Keep the last few measurements accessible for unit tests.
        bucket = self._debug_metrics[key]
        bucket.append(attributes)
        if len(bucket) > 10:
            bucket.pop(0)

    # Public API ---------------------------------------------------------
    def record_latency(
        self,
        agent: str,
        operation: str,
        duration_ms: float,
        attributes: Optional[Mapping[str, object]] = None,
    ) -> None:
        self._ensure_initialized()
        if self._disabled or self._latency_histogram is None:
            debug_attrs = self._build_attributes(agent, operation, attributes)
            debug_attrs.setdefault("sli", "latency")
            debug_attrs["latency_ms"] = duration_ms
            self._record_debug("latency", debug_attrs)
            return

        metric_attributes = self._build_attributes(agent, operation, attributes)
        metric_attributes["latency_ms"] = duration_ms
        metric_attributes.setdefault("sli", "latency")
        self._latency_histogram.record(duration_ms, metric_attributes)
        self._record_debug("latency", metric_attributes)

    def record_success(
        self, agent: str, operation: str, attributes: Optional[Mapping[str, object]] = None
    ) -> None:
        self._ensure_initialized()
        metric_attributes = self._build_attributes(agent, operation, attributes)
        metric_attributes.setdefault("sli", "success_rate")
        if not self._disabled and self._success_counter is not None:
            self._success_counter.add(1, metric_attributes)
        self._record_debug("success", metric_attributes)

    def record_error(
        self, agent: str, operation: str, attributes: Optional[Mapping[str, object]] = None
    ) -> None:
        self._ensure_initialized()
        metric_attributes = self._build_attributes(agent, operation, attributes)
        metric_attributes.setdefault("sli", "success_rate")
        if not self._disabled and self._error_counter is not None:
            self._error_counter.add(1, metric_attributes)
        self._record_debug("error", metric_attributes)

    def record_inconsistency(
        self,
        agent: str,
        operation: str,
        count: int,
        attributes: Optional[Mapping[str, object]] = None,
    ) -> None:
        if count <= 0:
            return
        self._ensure_initialized()
        metric_attributes = self._build_attributes(agent, operation, attributes)
        metric_attributes.setdefault("sli", "inconsistencies")
        metric_attributes["count"] = count
        if not self._disabled and self._inconsistency_counter is not None:
            self._inconsistency_counter.add(count, metric_attributes)
        self._record_debug("inconsistency", metric_attributes)

    # Debug helpers ------------------------------------------------------
    def get_debug_samples(self, metric: str) -> Iterable[MetricAttributes]:
        return tuple(self._debug_metrics.get(metric, []))


telemetry = TelemetryService()

