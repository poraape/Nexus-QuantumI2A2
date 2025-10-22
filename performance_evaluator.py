from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from backend.app.performance_evaluator import PerformanceEvaluator


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Runtime performance evaluator - analyse latency, validation, and tuning readiness."
    )
    parser.add_argument(
        "--mode",
        choices=["dry_run", "safe_apply"],
        default="dry_run",
        help="Execution mode. safe_apply includes optimization plans.",
    )
    parser.add_argument(
        "--environment",
        choices=["dev", "stage", "prod"],
        default="stage",
        help="Target environment for contextual metadata.",
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=Path("docs/runtime_evaluator_manifest.json"),
        help="Path to the runtime evaluator manifest.",
    )
    parser.add_argument(
        "--format",
        choices=["console", "json"],
        default="console",
        help="Output format printed to stdout.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Optional path to persist the evaluation report in JSON.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    evaluator = PerformanceEvaluator(
        manifest_path=args.manifest,
        mode=args.mode,
        environment=args.environment,
    )
    report = evaluator.run()

    if args.output:
        args.output.write_text(json.dumps(report.to_dict(), indent=2), encoding="utf-8")

    if args.format == "json":
        print(json.dumps(report.to_dict(), indent=2))
    else:
        _print_console(report)

    exit_code = 1 if any(report.blocking_conditions.values()) else 0
    return exit_code


def _print_console(report) -> None:
    print("[Runtime Performance Evaluator]")
    print(f" Mode         : {report.mode}")
    print(f" Environment  : {report.environment}")
    print(f" Timestamp    : {report.timestamp}")
    print(f" Efficiency   : {report.efficiency_score:.2f}")
    print(" Metrics:")
    for metric in report.metrics:
        print(
            f"  - {metric.name}: {metric.value:.2f} ms "
            f"(expected {metric.expected} ms / max {metric.max_allowed} ms) -> {metric.status}"
        )
    if report.blocking_conditions:
        print(" Blocking conditions:")
        for condition, triggered in report.blocking_conditions.items():
            print(f"  - {condition}: {'triggered' if triggered else 'ok'}")
    print(" Artifacts:")
    print(f"  - Runtime trace   : {report.runtime_trace_path}")
    print(f"  - Data validation : {report.data_validation_path}")
    print(f"  - Null metric     : {report.null_fix_path}")
    print(f"  - Benchmark       : {report.benchmark_path}")
    print(f"  - Auto tuning     : {report.auto_tuning_path}")
    print(f"  - Audit log       : {report.audit_log_path}")


if __name__ == "__main__":
    sys.exit(main())
