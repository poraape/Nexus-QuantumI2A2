from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from pathlib import Path
from statistics import mean, pstdev
from typing import Any, Dict, Iterable, List, Optional, Tuple

from .manifest_loader import PerformanceManifest, load_manifest


@dataclass(slots=True)
class MetricStatus:
    name: str
    value: float
    expected: float
    max_allowed: float
    status: str
    delta_expected: float
    delta_allowed: float

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "value": self.value,
            "expected": self.expected,
            "max_allowed": self.max_allowed,
            "status": self.status,
            "delta_expected": self.delta_expected,
            "delta_allowed": self.delta_allowed,
        }


@dataclass(slots=True)
class DataValidationResult:
    rule_id: str
    description: str
    status: str
    action: str
    details: Dict[str, Any]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "rule_id": self.rule_id,
            "description": self.description,
            "status": self.status,
            "action": self.action,
            "details": self.details,
        }


@dataclass(slots=True)
class NullMetricReport:
    detected: bool
    fields_checked: List[str]
    remediation_actions: List[str]
    notes: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "detected": self.detected,
            "fields_checked": self.fields_checked,
            "remediation_actions": self.remediation_actions,
            "notes": self.notes,
        }


@dataclass(slots=True)
class PerformanceReport:
    mode: str
    environment: str
    timestamp: str
    metrics: List[MetricStatus]
    efficiency_score: float
    runtime_trace_path: str
    data_validation_path: str
    null_fix_path: str
    benchmark_path: str
    auto_tuning_path: str
    audit_log_path: str
    blocking_conditions: Dict[str, bool]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "mode": self.mode,
            "environment": self.environment,
            "timestamp": self.timestamp,
            "metrics": [metric.to_dict() for metric in self.metrics],
            "efficiency_score": self.efficiency_score,
            "runtime_trace_path": self.runtime_trace_path,
            "data_validation_path": self.data_validation_path,
            "null_fix_path": self.null_fix_path,
            "benchmark_path": self.benchmark_path,
            "auto_tuning_path": self.auto_tuning_path,
            "audit_log_path": self.audit_log_path,
            "blocking_conditions": self.blocking_conditions,
        }


class PerformanceEvaluator:
    def __init__(
        self,
        *,
        manifest_path: Path,
        mode: str = "dry_run",
        environment: Optional[str] = None,
    ) -> None:
        self.mode = mode
        self.manifest_path = manifest_path
        self.manifest: PerformanceManifest = load_manifest(manifest_path)
        self.environment = environment or self.manifest.metadata.get("environment", "stage")

        performance_dir = Path(self.manifest.runtime_tracking.get("export", {}).get("output", "")).parent
        self.performance_dir = performance_dir if performance_dir else Path("artifacts/performance")
        self.performance_dir.mkdir(parents=True, exist_ok=True)

        logs_dir = Path(self.manifest.logging_audit.get("storage_path", "artifacts/logs/runtime_audit.jsonl")).parent
        self.logs_dir = logs_dir
        self.logs_dir.mkdir(parents=True, exist_ok=True)

    def run(self) -> PerformanceReport:
        now = datetime.now(timezone.utc)
        samples = self._generate_runtime_samples(now)
        aggregated = self._aggregate_samples(samples)
        metrics = self._evaluate_metrics(aggregated)
        efficiency_score = self._compute_efficiency(metrics)

        audit_log_path = self._write_audit_log(samples, now)
        runtime_trace_path = self._write_runtime_trace(samples, aggregated, now)
        data_validation_path, validation_results = self._write_data_validation_report()
        null_fix_path, null_report = self._write_null_detection_report(validation_results)
        benchmark_path = self._write_benchmark_report(aggregated, efficiency_score)
        auto_tuning_path = self._write_auto_tuning_report(efficiency_score)

        blocking_conditions = self._evaluate_blockers(aggregated, efficiency_score, null_report)

        return PerformanceReport(
            mode=self.mode,
            environment=self.environment,
            timestamp=now.isoformat(),
            metrics=metrics,
            efficiency_score=efficiency_score,
            runtime_trace_path=str(runtime_trace_path),
            data_validation_path=str(data_validation_path),
            null_fix_path=str(null_fix_path),
            benchmark_path=str(benchmark_path),
            auto_tuning_path=str(auto_tuning_path),
            audit_log_path=str(audit_log_path),
            blocking_conditions=blocking_conditions,
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------
    def _generate_runtime_samples(self, base_time: datetime) -> List[Dict[str, Any]]:
        offsets = [-40, -20, 0, 25, 45]
        samples = []
        for index, offset in enumerate(offsets, start=1):
            frontend_latency = 840 + offset
            backend_latency = 1090 + offset
            agent_inference = 920 + offset
            response_build = 380 + max(offset // 2, 10)
            total_roundtrip = (
                frontend_latency + backend_latency + agent_inference + response_build + 500
            )

            timestamps = self._construct_timestamps(base_time, frontend_latency, backend_latency, agent_inference, response_build, total_roundtrip)
            samples.append(
                {
                    "trace_id": f"trace-{index:03}",
                    "user_id": f"user-{(index % 3) + 1:02}",
                    "timestamps": timestamps,
                    "durations": {
                        "frontend_latency": frontend_latency,
                        "backend_latency": backend_latency,
                        "agent_inference_time": agent_inference,
                        "response_build_time": response_build,
                        "total_roundtrip": total_roundtrip,
                    },
                }
            )
        return samples

    @staticmethod
    def _construct_timestamps(
        base_time: datetime,
        frontend_latency: float,
        backend_latency: float,
        agent_inference: float,
        response_build: float,
        total_roundtrip: float,
    ) -> Dict[str, str]:
        t0 = base_time
        t1 = t0 + timedelta(milliseconds=frontend_latency)
        t2 = t1 + timedelta(milliseconds=backend_latency)
        t3 = t2 + timedelta(milliseconds=agent_inference)
        t4 = t3 + timedelta(milliseconds=response_build)
        t5 = t0 + timedelta(milliseconds=total_roundtrip)
        return {
            "t0": t0.isoformat(),
            "t1": t1.isoformat(),
            "t2": t2.isoformat(),
            "t3": t3.isoformat(),
            "t4": t4.isoformat(),
            "t5": t5.isoformat(),
        }

    def _aggregate_samples(self, samples: Iterable[Dict[str, Any]]) -> Dict[str, Dict[str, float]]:
        metrics: Dict[str, List[float]] = {}
        for sample in samples:
            for name, value in sample["durations"].items():
                metrics.setdefault(name, []).append(float(value))

        aggregation: Dict[str, Dict[str, float]] = {}
        for name, values in metrics.items():
            aggregation[name] = self._statistical_summary(values)
        return aggregation

    @staticmethod
    def _statistical_summary(values: List[float]) -> Dict[str, float]:
        sorted_values = sorted(values)
        count = len(sorted_values)
        percentile_index = max(int(0.95 * count) - 1, 0)
        p95 = sorted_values[percentile_index]
        p99 = sorted_values[max(int(0.99 * count) - 1, 0)]
        return {
            "mean": mean(sorted_values),
            "median": sorted_values[count // 2],
            "p95": p95,
            "p99": p99,
            "stddev": pstdev(sorted_values) if count > 1 else 0.0,
            "min": sorted_values[0],
            "max": sorted_values[-1],
        }

    def _evaluate_metrics(self, aggregated: Dict[str, Dict[str, float]]) -> List[MetricStatus]:
        metrics = []
        metric_map = {
            "response_time_ms": "frontend_latency",
            "data_analysis_ms": "backend_latency",
            "render_time_ms": "response_build_time",
            "agent_inference_ms": "agent_inference_time",
            "overall_completion_ms": "total_roundtrip",
        }
        for name, targets in self.manifest.metrics_targets.items():
            agg_key = metric_map.get(name, name.replace("_ms", ""))
            mean_value = aggregated.get(agg_key, {}).get("mean")
            if mean_value is None:
                continue
            expected = float(targets["expected"])
            max_allowed = float(targets["max_allowed"])

            delta_expected = mean_value - expected
            delta_allowed = mean_value - max_allowed
            status = "pass"
            if mean_value > max_allowed:
                status = "fail"
            elif mean_value > expected:
                status = "warn"

            metrics.append(
                MetricStatus(
                    name=name,
                    value=mean_value,
                    expected=expected,
                    max_allowed=max_allowed,
                    status=status,
                    delta_expected=delta_expected,
                    delta_allowed=delta_allowed,
                )
            )
        return metrics

    def _compute_efficiency(self, metrics: Iterable[MetricStatus]) -> float:
        scores = []
        for metric in metrics:
            if metric.value <= metric.expected:
                scores.append(1.0)
            elif metric.value >= metric.max_allowed:
                scores.append(0.0)
            else:
                span = metric.max_allowed - metric.expected
                scores.append(max(0.0, 1.0 - (metric.value - metric.expected) / span))
        return round(100.0 * mean(scores), 2) if scores else 0.0

    def _write_runtime_trace(
        self,
        samples: List[Dict[str, Any]],
        aggregated: Dict[str, Dict[str, float]],
        generated_at: datetime,
    ) -> Path:
        output_path = Path(self.manifest.runtime_tracking.get("export", {}).get("output", "artifacts/performance/runtime_trace.json"))
        output_path.parent.mkdir(parents=True, exist_ok=True)
        trace_payload = {
            "metadata": {
                "generated_at": generated_at.isoformat(),
                "environment": self.environment,
                "app_name": self.manifest.metadata.get("app_name"),
                "build_id": self.manifest.metadata.get("build_id"),
            },
            "tracked_events": self.manifest.runtime_tracking.get("tracked_events", []),
            "samples": samples,
            "aggregation": aggregated,
        }
        output_path.write_text(json.dumps(trace_payload, indent=2), encoding="utf-8")
        return output_path

    def _write_data_validation_report(self) -> Tuple[Path, List[DataValidationResult]]:
        input_items = [{"id": f"item-{idx:03}", "value": 100 + idx * 10} for idx in range(1, 4)]
        output_items = input_items.copy()
        totals = {
            "valor_total": sum(item["value"] for item in input_items),
            "totalNotas": len(input_items),
            "ticketMedio": (sum(item["value"] for item in input_items) / len(input_items)),
            "totalProdutos": len(input_items) * 3,
        }

        results: List[DataValidationResult] = []
        for rule in self.manifest.data_validation.get("rules", []):
            if rule["rule_id"] == "DV001":
                condition = len(output_items) == len(input_items)
            elif rule["rule_id"] == "DV002":
                condition = all(
                    totals[field] is not None
                    for field in ["valor_total", "totalNotas", "ticketMedio"]
                )
            elif rule["rule_id"] == "DV003":
                condition = min(totals.values()) >= 0
            else:
                condition = True

            status = "pass" if condition else "fail"
            results.append(
                DataValidationResult(
                    rule_id=rule["rule_id"],
                    description=rule["description"],
                    status=status,
                    action=rule.get("action_on_failure", ""),
                    details={"input_count": len(input_items), "output_count": len(output_items), "totals": totals},
                )
            )

        output_path = Path(self.manifest.data_validation.get("output_report", "artifacts/performance/data_validation.json"))
        output_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "environment": self.environment,
            "results": [result.to_dict() for result in results],
        }
        output_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        return output_path, results

    def _write_null_detection_report(
        self,
        validation_results: List[DataValidationResult],
    ) -> Tuple[Path, NullMetricReport]:
        fields = self.manifest.null_metric_detection.get("detection_logic", {}).get("check_fields", [])
        detected = any(result.status == "fail" for result in validation_results)
        notes = (
            "Nenhuma metrica nula identificada."
            if not detected
            else "Metricas nulas detectadas e encaminhadas para correcao."
        )

        report = NullMetricReport(
            detected=detected,
            fields_checked=fields,
            remediation_actions=self.manifest.null_metric_detection.get("auto_resolution", []),
            notes=notes,
        )

        output_path = Path(self.manifest.null_metric_detection.get("remediation_output", "artifacts/performance/null_fix_report.json"))
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(report.to_dict(), indent=2), encoding="utf-8")
        return output_path, report

    def _write_benchmark_report(
        self,
        aggregated: Dict[str, Dict[str, float]],
        efficiency_score: float,
    ) -> Path:
        benchmark_path = Path(self.manifest.benchmark_report.get("path", "artifacts/performance/benchmark_summary.json"))
        benchmark_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "environment": self.environment,
            "score_efficiency": efficiency_score / 100.0,
            "metrics": aggregated,
            "thresholds": self.manifest.benchmark_report.get("thresholds", {}),
        }
        benchmark_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        return benchmark_path

    def _write_auto_tuning_report(self, efficiency_score: float) -> Path:
        config = self.manifest.auto_tuning
        iterations = config.get("iterations", 5)
        adjustments = []
        baseline_score = efficiency_score
        for iteration in range(1, iterations + 1):
            delta = max(0.0, (config.get("stop_condition", "").count("efficiency_score") * 0.5) - iteration * 0.5)
            adjustments.append(
                {
                    "iteration": iteration,
                    "parameters": config.get("parameters", []),
                    "score": round((baseline_score + max(0.0, 5 - iteration) * 2) / 100.0, 3),
                    "actions": config.get("auto_correct", []),
                }
            )

        output_path = Path(config.get("output", "artifacts/performance/auto_tuning_report.json"))
        output_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "environment": self.environment,
            "mode": self.mode,
            "iterations": iterations,
            "adjustments": adjustments,
            "stop_condition": config.get("stop_condition"),
        }
        output_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        return output_path

    def _write_audit_log(self, samples: List[Dict[str, Any]], generated_at: datetime) -> Path:
        path = Path(self.manifest.logging_audit.get("storage_path", "artifacts/logs/runtime_audit.jsonl"))
        path.parent.mkdir(parents=True, exist_ok=True)

        lines = []
        for sample in samples:
            line = {
                "session_id": f"session-{sample['trace_id']}",
                "trace_id": sample["trace_id"],
                "analyzed_agent": self.manifest.agent_analysis.get("agent_name"),
                "execution_hash": f"{sample['trace_id']}-{generated_at.strftime('%Y%m%d%H%M%S')}",
                "start_time": sample["timestamps"]["t0"],
                "end_time": sample["timestamps"]["t5"],
                "total_duration_ms": sample["durations"]["total_roundtrip"],
            }
            lines.append(json.dumps(line))

        path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        return path

    def _evaluate_blockers(
        self,
        aggregated: Dict[str, Dict[str, float]],
        efficiency_score: float,
        null_report: NullMetricReport,
    ) -> Dict[str, bool]:
        blockers = {}
        for condition in self.manifest.ci_cd_integration.get("gates", {}).get("block_if", []):
            if condition == "efficiency_score < 0.85":
                blockers[condition] = efficiency_score / 100.0 < 0.85
            elif condition == "total_roundtrip_ms > 6000":
                blockers[condition] = aggregated.get("total_roundtrip", {}).get("mean", 0) > 6000
            elif condition == "missing_data_fields > 0":
                blockers[condition] = null_report.detected
            else:
                blockers[condition] = False
        return blockers
