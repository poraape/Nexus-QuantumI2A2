"""Helpers to consolidate monitoring metrics into scheduled audit reports."""
from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Mapping, MutableMapping, Optional

from app.services.monitoring.metrics_collector import MetricsCollector, metrics_collector


def _timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass(slots=True)
class ScheduledReport:
    """Structured payload returned by the scheduled report generator."""

    schedule: str
    generated_at: str
    metrics: Mapping[str, Mapping[str, object]]
    adjustments: Mapping[str, object]
    summary: MutableMapping[str, object]

    def to_dict(self) -> Dict[str, object]:
        payload = {
            "schedule": self.schedule,
            "generated_at": self.generated_at,
            "metrics": self.metrics,
            "adjustments": self.adjustments,
            "summary": dict(self.summary),
        }
        return payload


class AuditReportGenerator:
    """Consolidates metrics into JSON reports that can be scheduled via cron/airflow."""

    def __init__(self, collector: MetricsCollector | None = None) -> None:
        self.collector = collector or metrics_collector

    def build_report(self, schedule: str) -> ScheduledReport:
        payload = self.collector.export_payload()
        metrics = payload.get("metrics", {})
        adjustments = payload.get("adjustments", {})
        generated_at = payload.get("generated_at", _timestamp())

        summary: MutableMapping[str, object] = {
            "agents_tracked": len(metrics),
            "adjustments_active": sum(len(value) for value in adjustments.values()),
        }

        latency_values = [
            metric.get("average_latency_ms")
            for metric in metrics.values()
            if isinstance(metric, Mapping)
        ]
        latency_values = [value for value in latency_values if isinstance(value, (int, float))]
        if latency_values:
            summary["average_latency_ms"] = round(sum(latency_values) / len(latency_values), 2)

        return ScheduledReport(
            schedule=schedule,
            generated_at=generated_at,
            metrics=metrics,
            adjustments=adjustments,
            summary=summary,
        )

    def write_report(
        self,
        schedule: str,
        *,
        output_dir: Path | str,
        filename: Optional[str] = None,
    ) -> Path:
        report = self.build_report(schedule)
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)

        if not filename:
            slug = schedule.lower().replace(" ", "-")
            timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
            filename = f"audit-metrics-{slug}-{timestamp}.json"

        destination = output_path / filename
        destination.write_text(json.dumps(report.to_dict(), indent=2, sort_keys=True), encoding="utf-8")
        return destination


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Gera relatórios de métricas consolidadas")
    parser.add_argument("--schedule", default="hourly", help="Identificador do agendamento (ex.: hourly, nightly)")
    parser.add_argument("--output", default="reports/monitoring", help="Diretório onde os relatórios serão salvos")
    parser.add_argument("--filename", help="Nome opcional do arquivo gerado")
    return parser.parse_args()


def main() -> None:  # pragma: no cover - CLI helper
    args = _parse_args()
    generator = AuditReportGenerator()
    path = generator.write_report(args.schedule, output_dir=args.output, filename=args.filename)
    print(f"Relatório gerado em {path}")


if __name__ == "__main__":  # pragma: no cover - CLI helper
    main()

