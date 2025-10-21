from __future__ import annotations

import socket
import ssl
import time
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Dict, Optional
from urllib.parse import urlparse

import httpx


class Severity(str, Enum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


class Status(str, Enum):
    PASS = "pass"
    WARN = "warn"
    FAIL = "fail"
    SKIP = "skip"


@dataclass(slots=True)
class CheckResult:
    name: str
    severity: Severity
    status: Status
    message: str
    category: str
    duration_ms: float
    details: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "severity": self.severity.value,
            "status": self.status.value,
            "message": self.message,
            "category": self.category,
            "duration_ms": self.duration_ms,
            "details": self.details,
        }


class BaseCheck:
    def __init__(self, name: str, description: str, *, severity: Severity, category: str) -> None:
        self.name = name
        self.description = description
        self.severity = severity
        self.category = category

    def run(self) -> CheckResult:
        start = time.perf_counter()
        try:
            result = self._execute()
        except Exception as exc:  # pylint: disable=broad-except
            result = CheckResult(
                name=self.name,
                severity=self.severity,
                status=Status.FAIL,
                message=f"{self.description} -> {exc}",
                category=self.category,
                duration_ms=(time.perf_counter() - start) * 1000,
                details={"exception": type(exc).__name__},
            )
        else:
            result.duration_ms = (time.perf_counter() - start) * 1000
        return result

    def _execute(self) -> CheckResult:  # pragma: no cover - implemented by subclasses
        raise NotImplementedError


class DNSResolutionCheck(BaseCheck):
    def __init__(self, host: str, *, severity: Severity, category: str = "availability") -> None:
        super().__init__(
            name=f"dns:{host}",
            description=f"Resolve DNS for {host}",
            severity=severity,
            category=category,
        )
        self.host = host

    def _execute(self) -> CheckResult:
        try:
            records = socket.getaddrinfo(self.host, None)
        except socket.gaierror as err:
            return CheckResult(
                name=self.name,
                severity=self.severity,
                status=Status.FAIL,
                message=f"DNS resolution failed for {self.host}: {err}",
                category=self.category,
                duration_ms=0.0,
                details={"error": str(err)},
            )

        addresses = sorted({info[4][0] for info in records if info and info[4]})
        return CheckResult(
            name=self.name,
            severity=self.severity,
            status=Status.PASS,
            message=f"Resolved {self.host} to {', '.join(addresses)}",
            category=self.category,
            duration_ms=0.0,
            details={"addresses": addresses},
        )


class TCPConnectivityCheck(BaseCheck):
    def __init__(
        self,
        host: str,
        port: int,
        *,
        severity: Severity,
        timeout: float = 3.0,
        category: str = "availability",
    ) -> None:
        super().__init__(
            name=f"tcp:{host}:{port}",
            description=f"Check TCP connectivity to {host}:{port}",
            severity=severity,
            category=category,
        )
        self.host = host
        self.port = port
        self.timeout = timeout

    def _execute(self) -> CheckResult:
        try:
            with socket.create_connection((self.host, self.port), timeout=self.timeout) as conn:
                conn.settimeout(self.timeout)
        except OSError as err:
            return CheckResult(
                name=self.name,
                severity=self.severity,
                status=Status.FAIL,
                message=f"Cannot connect to {self.host}:{self.port} -> {err}",
                category=self.category,
                duration_ms=0.0,
                details={"error": str(err)},
            )

        return CheckResult(
            name=self.name,
            severity=self.severity,
            status=Status.PASS,
            message=f"TCP connectivity to {self.host}:{self.port} succeeded",
            category=self.category,
            duration_ms=0.0,
            details={},
        )


class HTTPEndpointCheck(BaseCheck):
    def __init__(
        self,
        url: str,
        *,
        method: str,
        expected_status: int,
        headers: Optional[Dict[str, str]] = None,
        payload: Optional[Dict[str, Any]] = None,
        severity: Severity,
        category: str = "availability",
        timeout: float = 5.0,
        verify: bool = True,
    ) -> None:
        super().__init__(
            name=f"http:{method.upper()} {url}",
            description=f"HTTP {method.upper()} check to {url}",
            severity=severity,
            category=category,
        )
        self.url = url
        self.method = method.upper()
        self.expected_status = expected_status
        self.headers = headers or {}
        self.payload = payload
        self.timeout = timeout
        self.verify = verify

    def _execute(self) -> CheckResult:
        request_kwargs: Dict[str, Any] = {
            "headers": self.headers,
            "timeout": self.timeout,
        }
        if self.payload is not None:
            request_kwargs["json"] = self.payload

        with httpx.Client(verify=self.verify, timeout=self.timeout) as client:
            response = client.request(self.method, self.url, **request_kwargs)

        if response.status_code == self.expected_status:
            status = Status.PASS
            message = (
                f"{self.method} {self.url} returned expected status {self.expected_status}"
            )
        else:
            status = Status.FAIL if response.status_code >= 500 else Status.WARN
            message = (
                f"{self.method} {self.url} returned {response.status_code}, "
                f"expected {self.expected_status}"
            )

        return CheckResult(
            name=self.name,
            severity=self.severity,
            status=status,
            message=message,
            category=self.category,
            duration_ms=0.0,
            details={
                "status_code": response.status_code,
                "headers": dict(response.headers),
                "body": response.text[:500],
            },
        )


class TLSCertificateCheck(BaseCheck):
    def __init__(
        self,
        host: str,
        port: int,
        *,
        min_valid_days: int,
        severity: Severity,
        category: str = "security",
    ) -> None:
        super().__init__(
            name=f"tls:{host}:{port}",
            description=f"Validate TLS certificate for {host}:{port}",
            severity=severity,
            category=category,
        )
        self.host = host
        self.port = port
        self.min_valid_days = min_valid_days

    def _execute(self) -> CheckResult:
        context = ssl.create_default_context()
        context.check_hostname = True
        context.verify_mode = ssl.CERT_REQUIRED

        try:
            with socket.create_connection((self.host, self.port), timeout=4.0) as sock:
                with context.wrap_socket(sock, server_hostname=self.host) as tls_sock:
                    cert = tls_sock.getpeercert()
        except ssl.SSLError as err:
            return CheckResult(
                name=self.name,
                severity=self.severity,
                status=Status.FAIL,
                message=f"TLS handshake failed for {self.host}:{self.port}: {err}",
                category=self.category,
                duration_ms=0.0,
                details={"error": str(err)},
            )
        except OSError as err:
            return CheckResult(
                name=self.name,
                severity=self.severity,
                status=Status.FAIL,
                message=f"Cannot establish TLS connection to {self.host}:{self.port}: {err}",
                category=self.category,
                duration_ms=0.0,
                details={"error": str(err)},
            )

        not_after = cert.get("notAfter")
        if not not_after:
            return CheckResult(
                name=self.name,
                severity=self.severity,
                status=Status.FAIL,
                message="Certificate missing notAfter field",
                category=self.category,
                duration_ms=0.0,
                details={"certificate": cert},
            )

        expiry = datetime.strptime(not_after, "%b %d %H:%M:%S %Y %Z")
        days_left = (expiry - datetime.utcnow()).days

        if days_left < self.min_valid_days:
            status = Status.WARN if days_left >= 0 else Status.FAIL
            message = (
                f"Certificate for {self.host} expires in {days_left} days "
                f"(min required {self.min_valid_days})"
            )
        else:
            status = Status.PASS
            message = f"Certificate for {self.host} valid for {days_left} more days"

        return CheckResult(
            name=self.name,
            severity=self.severity,
            status=status,
            message=message,
            category=self.category,
            duration_ms=0.0,
            details={"expires_at": not_after, "days_remaining": days_left},
        )


class PolicyComplianceCheck(BaseCheck):
    def __init__(
        self,
        name: str,
        description: str,
        *,
        predicate: bool,
        severity: Severity,
        category: str = "compliance",
        details: Optional[Dict[str, Any]] = None,
    ) -> None:
        super().__init__(
            name=f"policy:{name}",
            description=description,
            severity=severity,
            category=category,
        )
        self.predicate = predicate
        self.check_details = details or {}

    def _execute(self) -> CheckResult:
        status = Status.PASS if self.predicate else Status.FAIL
        message = (
            f"{self.description} -> {'compliant' if self.predicate else 'non-compliant'}"
        )
        return CheckResult(
            name=self.name,
            severity=self.severity,
            status=status,
            message=message,
            category=self.category,
            duration_ms=0.0,
            details=self.check_details,
        )


def extract_host_from_url(url: str) -> str:
    parsed = urlparse(url)
    return parsed.hostname or url


def extract_port_from_url(url: str) -> int:
    parsed = urlparse(url)
    if parsed.port:
        return parsed.port
    if parsed.scheme == "https":
        return 443
    if parsed.scheme == "http":
        return 80
    return 0
