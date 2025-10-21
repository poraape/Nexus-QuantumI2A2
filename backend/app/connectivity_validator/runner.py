from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from .checks import (
    BaseCheck,
    DNSResolutionCheck,
    HTTPEndpointCheck,
    PolicyComplianceCheck,
    TCPConnectivityCheck,
    TLSCertificateCheck,
    CheckResult,
    Severity,
    Status,
    extract_host_from_url,
    extract_port_from_url,
)
from .manifest_loader import ConnectivityManifest, load_manifest


@dataclass(slots=True)
class ValidationResult:
    manifest_name: str
    environment: str
    mode: str
    timestamp: str
    results: List[CheckResult]
    summary: Dict[str, Any]
    scores: Dict[str, float]
    blocking_conditions: Dict[str, bool]
    remediation: Dict[str, Any]
    artifacts: Dict[str, Any]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "manifest_name": self.manifest_name,
            "environment": self.environment,
            "mode": self.mode,
            "timestamp": self.timestamp,
            "summary": self.summary,
            "scores": self.scores,
            "blocking_conditions": self.blocking_conditions,
            "remediation": self.remediation,
            "artifacts": self.artifacts,
            "checks": [result.to_dict() for result in self.results],
        }

    def to_markdown(self) -> str:
        lines = [
            f"# Connectivity Report - {self.manifest_name}",
            "",
            f"- Environment: `{self.environment}`",
            f"- Mode: `{self.mode}`",
            f"- Generated at: `{self.timestamp}`",
            "",
            "## Summary",
            f"- Total checks: {self.summary['total']}",
            f"- Passed: {self.summary['pass']}",
            f"- Warn: {self.summary['warn']}",
            f"- Fail: {self.summary['fail']}",
            f"- Critical failures: {self.summary['critical_failures']}",
            "",
            "## Scores",
        ]
        for key, value in self.scores.items():
            lines.append(f"- {key.title()}: {value:.2f}")

        lines.append("")
        lines.append("## Blocking Conditions")
        for key, value in self.blocking_conditions.items():
            lines.append(f"- {key}: {'triggered' if value else 'ok'}")

        lines.append("")
        lines.append("## Checks")
        for check in self.results:
            lines.extend(
                [
                    f"### {check.name}",
                    f"- Severity: `{check.severity.value}`",
                    f"- Status: `{check.status.value}`",
                    f"- Category: `{check.category}`",
                    f"- Message: {check.message}",
                    "",
                ]
            )

        if self.remediation.get("playbooks"):
            lines.append("## Suggested Remediation")
            for item in self.remediation["playbooks"]:
                lines.append(f"- **{item['trigger']}**: {', '.join(item['actions'])}")

        return "\n".join(lines)


class ConnectivityValidator:
    """Run declarative connectivity validations defined in the manifest."""

    def __init__(
        self,
        *,
        manifest_path: Path,
        mode: str,
        environment: str,
        artifacts_dir: Optional[Path] = None,
    ) -> None:
        self.mode = mode
        self.environment = environment
        self.manifest_path = manifest_path
        self.manifest = load_manifest(manifest_path)
        default_artifact = (
            self.manifest.manifest.get("artifacts", {})
            .get("paths", {})
            .get("reports", "artifacts/reports")
        )
        self.artifacts_dir = artifacts_dir or Path(default_artifact)
        self.artifacts_dir.mkdir(parents=True, exist_ok=True)

    def run(self) -> ValidationResult:
        checks = list(self._build_checks())
        results = [check.run() for check in checks]

        summary = self._build_summary(results)
        scores = self._calculate_scores(results)
        blocking_conditions = self._evaluate_blocking_conditions(summary, scores)
        remediation = self._build_remediation(results)
        artifacts = self._materialise_artifacts(results, summary, scores, remediation)

        return ValidationResult(
            manifest_name=self.manifest.name,
            environment=self.environment,
            mode=self.mode,
            timestamp=datetime.now(timezone.utc).isoformat(),
            results=results,
            summary=summary,
            scores=scores,
            blocking_conditions=blocking_conditions,
            remediation=remediation,
            artifacts=artifacts,
        )

    # Internal helpers -------------------------------------------------

    def _build_checks(self) -> Iterable[BaseCheck]:
        env_config = self._get_environment_config()
        base_url = env_config.get("base_url")
        host = extract_host_from_url(base_url)
        severity = self._severity_for_env()

        yield DNSResolutionCheck(host, severity=severity)

        ports = self.manifest.topology.get("ports", {})
        for service, port in ports.items():
            service_host = self._resolve_service_host(service, base_host=host)
            yield DNSResolutionCheck(service_host, severity=Severity.WARNING)
            if port:
                yield TCPConnectivityCheck(
                    service_host,
                    int(port),
                    severity=severity,
                    timeout=self._connect_timeout(),
                )

        for name, endpoint in self.manifest.endpoints.items():
            base = endpoint.get("base_url")
            if not base:
                continue
            host = extract_host_from_url(base)
            yield DNSResolutionCheck(host, severity=Severity.CRITICAL)
            host_port = extract_port_from_url(base)
            if host_port:
                yield TCPConnectivityCheck(
                    host,
                    host_port,
                    severity=Severity.CRITICAL,
                    timeout=self._connect_timeout(),
                )

            methods = endpoint.get("methods", {})
            for method, spec in methods.items():
                method_parts = method.split()
                if len(method_parts) != 2:
                    continue
                verb, path = method_parts
                url = f"{base}{path}"
                expected_status = spec.get("expected_status", 200)
                headers = spec.get("headers", {})
                payload = spec.get("example_request")
                yield HTTPEndpointCheck(
                    url,
                    method=verb,
                    expected_status=expected_status,
                    headers=headers,
                    payload=payload,
                    severity=Severity.CRITICAL if verb.upper() != "GET" else severity,
                    timeout=self._request_timeout(),
                )

        tls_min_version = self.manifest.compliance_security.get("tls_min_version", "1.2")
        cert_grace_days = 30 if self.environment == "prod" else 7
        for endpoint in self.manifest.endpoints.values():
            base = endpoint.get("base_url")
            if not base:
                continue
            host = extract_host_from_url(base)
            port = extract_port_from_url(base) or 443
            yield TLSCertificateCheck(
                host,
                port,
                min_valid_days=cert_grace_days,
                severity=Severity.CRITICAL,
            )

        tls_version_ok = self._parse_tls_version(tls_min_version) >= 1.2
        yield PolicyComplianceCheck(
            name="tls_min_version",
            description="TLS minimum version >= 1.2",
            predicate=tls_version_ok,
            severity=Severity.CRITICAL,
            details={"configured": tls_min_version},
        )

        rate_limits = self.manifest.compliance_security.get("rate_limits", {})
        predicate_rate_limit = rate_limits.get("per_ip_per_min", 0) <= 120
        yield PolicyComplianceCheck(
            name="rate_limits",
            description="Ingress rate limit capped at 120 req/min per IP",
            predicate=predicate_rate_limit,
            severity=Severity.WARNING,
            details={"configured": rate_limits},
        )

    def _severity_for_env(self) -> Severity:
        if self.environment == "prod":
            return Severity.CRITICAL
        if self.environment == "stage":
            return Severity.WARNING
        return Severity.INFO

    def _connect_timeout(self) -> float:
        resilience = self.manifest.resilience.get("timeouts", {})
        return resilience.get("connect_ms", 3000) / 1000.0

    def _request_timeout(self) -> float:
        resilience = self.manifest.resilience.get("timeouts", {})
        return resilience.get("read_ms", 5000) / 1000.0

    def _resolve_service_host(self, service: str, *, base_host: str) -> str:
        env_var = f"NXQ_{service.upper()}_HOST"
        host_from_env = os.getenv(env_var)
        if host_from_env:
            return host_from_env

        labels = base_host.split(".")
        domain = ".".join(labels[-3:]) if len(labels) >= 3 else base_host
        env_prefix = self.environment if self.environment != "prod" else ""
        service_host = f"{service}.{domain}"
        if env_prefix:
            service_host = f"{env_prefix}.{service_host}"
        return service_host

    def _build_summary(self, results: Iterable[CheckResult]) -> Dict[str, Any]:
        total = 0
        summary = {"pass": 0, "warn": 0, "fail": 0, "skip": 0, "critical_failures": 0}
        for result in results:
            total += 1
            summary[result.status.value] += 1
            if result.status == Status.FAIL and result.severity == Severity.CRITICAL:
                summary["critical_failures"] += 1
        summary["total"] = total
        return summary

    def _calculate_scores(self, results: Iterable[CheckResult]) -> Dict[str, float]:
        availability_checks = [
            result for result in results if result.category == "availability"
        ]
        security_checks = [result for result in results if result.category == "security"]
        compliance_checks = [
            result for result in results if result.category == "compliance"
        ]

        def score_for(checks: List[CheckResult]) -> float:
            if not checks:
                return 100.0
            passed = sum(1 for check in checks if check.status == Status.PASS)
            return 100.0 * passed / len(checks)

        availability = score_for(availability_checks)
        security = score_for(security_checks)
        compliance = score_for(compliance_checks)
        latency = 100.0  # No latency instrumentation yet

        weights = self.manifest.reporting.get("score_weights", {})
        score_overall = (
            availability * weights.get("availability", 0.0)
            + latency * weights.get("latency", 0.0)
            + security * weights.get("security", 0.0)
            + compliance * weights.get("compliance", 0.0)
        )

        return {
            "availability": availability,
            "latency": latency,
            "security": security,
            "compliance": compliance,
            "overall": score_overall,
        }

    def _evaluate_blocking_conditions(
        self, summary: Dict[str, Any], scores: Dict[str, float]
    ) -> Dict[str, bool]:
        blocking = {}
        for condition in self.manifest.reporting.get("blocking_conditions", []):
            if condition == "critical_count > 0":
                blocking[condition] = summary["critical_failures"] > 0
            elif condition == "score_overall < 85":
                blocking[condition] = scores.get("overall", 0.0) < 85.0
            else:
                blocking[condition] = False
        return blocking

    def _build_remediation(self, results: Iterable[CheckResult]) -> Dict[str, Any]:
        triggers = {self._infer_trigger(result) for result in results if result.status == Status.FAIL}
        triggers.discard(None)
        playbooks = []
        for trigger in triggers:
            for playbook in self.manifest.auto_remediation.get("playbooks", []):
                if playbook.get("trigger") == trigger:
                    playbooks.append(playbook)

        remediation: Dict[str, Any] = {"playbooks": playbooks}
        if self.mode == "safe_apply" and playbooks:
            remediation["patch_plan"] = self.manifest.manifest.get("patch_plan", {})
        return remediation

    def _materialise_artifacts(
        self,
        results: Iterable[CheckResult],
        summary: Dict[str, Any],
        scores: Dict[str, float],
        remediation: Dict[str, Any],
    ) -> Dict[str, Any]:
        report = {
            "results": [res.to_dict() for res in results],
            "summary": summary,
            "scores": scores,
            "remediation": remediation,
        }

        json_report_path = self.artifacts_dir / "connectivity-report.json"
        json_report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")

        markdown_path = self.artifacts_dir / "connectivity-report.md"
        markdown_path.write_text(self._render_markdown(report), encoding="utf-8")

        return {"json_report": str(json_report_path), "markdown_report": str(markdown_path)}

    def _render_markdown(self, report: Dict[str, Any]) -> str:
        lines = [
            "# Nexus Connectivity Validator Report",
            "",
            "## Summary",
        ]

        summary = report["summary"]
        lines.extend(
            [
                f"- Total: {summary['total']}",
                f"- Pass: {summary['pass']}",
                f"- Warn: {summary['warn']}",
                f"- Fail: {summary['fail']}",
                "",
                "## Scores",
            ]
        )

        for key, value in report["scores"].items():
            lines.append(f"- {key.title()}: {value:.2f}")

        lines.append("")
        lines.append("## Checks")
        for result in report["results"]:
            lines.extend(
                [
                    f"### {result['name']}",
                    f"- Status: `{result['status']}`",
                    f"- Severity: `{result['severity']}`",
                    f"- Message: {result['message']}",
                    "",
                ]
            )

        if report["remediation"].get("playbooks"):
            lines.append("## Suggested Remediation")
            for item in report["remediation"]["playbooks"]:
                lines.append(f"- **{item['trigger']}**: {', '.join(item['actions'])}")

        return "\n".join(lines)

    def _infer_trigger(self, result: CheckResult) -> Optional[str]:
        if result.status != Status.FAIL:
            return None
        if result.name.startswith("dns:"):
            return "DNS_FAIL"
        if result.name.startswith("tls:"):
            return "TLS_HANDSHAKE_ERROR"
        if "CORS" in result.message:
            return "CORS_BLOCK"
        if result.name.startswith("http:") and "502" in result.message:
            return "HTTP_502"
        if result.name.startswith("tcp:") and "5432" in result.name:
            return "DB_CONN_REFUSED"
        if result.name.startswith("tcp:") and "6379" in result.name:
            return "CACHE_TIMEOUT"
        return None

    def _get_environment_config(self) -> Dict[str, Any]:
        env_config = self.manifest.environments.get(self.environment)
        if not env_config:
            raise ValueError(f"Environment '{self.environment}' not defined in manifest")
        return env_config

    @staticmethod
    def _parse_tls_version(version: str) -> float:
        sanitized = version.upper().replace("TLS", "").replace("V", "").strip()
        try:
            return float(sanitized)
        except ValueError:
            return 0.0
