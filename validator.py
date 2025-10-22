from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from backend.app.connectivity_validator import ConnectivityValidator


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Nexus Connectivity Validator - diagnose service communication end-to-end."
    )
    parser.add_argument(
        "--mode",
        choices=["dry_run", "safe_apply"],
        default="dry_run",
        help="Execution mode. Use safe_apply to emit remediation patch plans.",
    )
    parser.add_argument(
        "--environment",
        choices=["dev", "stage", "prod"],
        default="dev",
        help="Target environment defined in the manifest env_matrix.",
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=Path("docs/nexus_connectivity_validator_manifest.json"),
        help="Path to the connectivity validator manifest.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Optional path to persist the full JSON report.",
    )
    parser.add_argument(
        "--format",
        choices=["console", "json", "markdown"],
        default="console",
        help="Output format to print to stdout.",
    )
    parser.add_argument(
        "--artifacts-dir",
        type=Path,
        default=None,
        help="Override manifest artifact directory for generated reports.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    validator = ConnectivityValidator(
        manifest_path=args.manifest,
        mode=args.mode,
        environment=args.environment,
        artifacts_dir=args.artifacts_dir,
    )
    result = validator.run()

    if args.output:
        args.output.write_text(json.dumps(result.to_dict(), indent=2), encoding="utf-8")

    if args.format == "json":
        print(json.dumps(result.to_dict(), indent=2))
    elif args.format == "markdown":
        print(result.to_markdown())
    else:
        _print_console(result)

    blocked = any(result.blocking_conditions.values())
    return 1 if blocked else 0


def _print_console(result) -> None:
    summary = result.summary
    scores = result.scores
    print(f"[Nexus Connectivity Validator] {result.manifest_name}")
    print(f" Environment : {result.environment}")
    print(f" Mode        : {result.mode}")
    print(f" Generated   : {result.timestamp}")
    print(" Summary:")
    print(f"   - Total checks : {summary['total']}")
    print(f"   - Pass         : {summary['pass']}")
    print(f"   - Warn         : {summary['warn']}")
    print(f"   - Fail         : {summary['fail']}")
    print(f"   - Critical     : {summary['critical_failures']}")
    print(" Scores:")
    for key, value in scores.items():
        print(f"   - {key.title():<12}: {value:.2f}")

    if result.remediation.get("playbooks"):
        print(" Suggested remediation:")
        for item in result.remediation["playbooks"]:
            print(f"   - {item['trigger']}: {', '.join(item['actions'])}")

    if any(result.blocking_conditions.values()):
        print(" Blocking conditions triggered:")
        for key, value in result.blocking_conditions.items():
            if value:
                print(f"   - {key}")


if __name__ == "__main__":
    sys.exit(main())
