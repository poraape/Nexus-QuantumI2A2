"""Unit tests for the in-memory metrics collector and EfficiencyGuard."""
from __future__ import annotations

import importlib.util
import sys
import types
from pathlib import Path

import pytest


def _load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


ROOT = Path(__file__).resolve().parents[2] / "app"

backend_pkg = types.ModuleType("backend")
backend_app_pkg = types.ModuleType("backend.app")
backend_app_services_pkg = types.ModuleType("backend.app.services")
backend_app_services_monitoring_pkg = types.ModuleType("backend.app.services.monitoring")

backend_pkg.app = backend_app_pkg  # type: ignore[attr-defined]
backend_app_pkg.services = backend_app_services_pkg  # type: ignore[attr-defined]
backend_app_services_pkg.monitoring = backend_app_services_monitoring_pkg  # type: ignore[attr-defined]

sys.modules.setdefault("backend", backend_pkg)
sys.modules.setdefault("backend.app", backend_app_pkg)
sys.modules.setdefault("backend.app.services", backend_app_services_pkg)
sys.modules.setdefault("backend.app.services.monitoring", backend_app_services_monitoring_pkg)

config_module = _load_module("backend.app.config", ROOT / "config.py")
sys.modules.setdefault("app.config", config_module)
setattr(backend_app_pkg, "config", config_module)

metrics_module = _load_module(
    "backend.app.services.monitoring.metrics_collector",
    ROOT / "services" / "monitoring" / "metrics_collector.py",
)

EfficiencyGuard = metrics_module.EfficiencyGuard
MetricsCollector = metrics_module.MetricsCollector


def test_metrics_collector_accumulates_metrics() -> None:
    guard = EfficiencyGuard(
        {"default": {"latency_ms": 500.0, "error_rate": 0.5, "throughput_min": 1, "consecutive_retries": 3}},
        max_timeout_ms=5_000,
        timeout_step_ms=500,
    )
    collector = MetricsCollector(guard)

    collector.record_execution("auditor", duration_ms=120.0, success=True, metadata={"timeout_ms": 2_000})
    collector.record_execution("auditor", duration_ms=80.0, success=True, metadata={"timeout_ms": 2_000})

    snapshot = collector.get_snapshot()
    assert "auditor" in snapshot
    auditor_metrics = snapshot["auditor"]
    assert auditor_metrics["executions"] == 2
    assert pytest.approx(auditor_metrics["average_latency_ms"], rel=1e-3) == 100.0
    assert auditor_metrics["error_rate"] == 0.0


def test_efficiency_guard_triggers_adjustment() -> None:
    guard = EfficiencyGuard(
        {"default": {"latency_ms": 50.0, "error_rate": 0.5, "throughput_min": 2, "consecutive_retries": 2}},
        max_timeout_ms=10_000,
        timeout_step_ms=1_000,
    )
    collector = MetricsCollector(guard)

    decisions = collector.record_execution(
        "classifier",
        duration_ms=120.0,
        success=True,
        metadata={"timeout_ms": 1_500},
    )

    assert decisions, "Esperava ajustes automáticos ao exceder o threshold"
    assert any(decision.action == "update_timeout" for decision in decisions)

    export = collector.export_payload()
    assert "metrics" in export and "adjustments" in export
    assert "classifier" in export["adjustments"]
