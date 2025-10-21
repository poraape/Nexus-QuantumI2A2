"""Motor de regras simplificado."""
from __future__ import annotations

from typing import Iterable

from app.schemas import AuditIssue

VALID_CFOPS = {"5102", "6102"}


def validate_cfop(cfop: str) -> Iterable[AuditIssue]:
    if cfop not in VALID_CFOPS:
        yield AuditIssue(code="CFOP_INVALID", message=f"CFOP {cfop} não é permitido", severity="error")


def validate_document(document) -> list[AuditIssue]:  # type: ignore[override]
    issues: list[AuditIssue] = []
    for item in document.items:
        issues.extend(validate_cfop(document.metadata.get("cfop", "0000")))
    return issues
