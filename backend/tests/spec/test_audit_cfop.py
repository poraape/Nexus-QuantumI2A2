from __future__ import annotations

from app.rules.engine import validate_cfop


def test_audit_cfop_requirement() -> None:
    issues = list(validate_cfop("9999"))
    assert any(issue.code == "CFOP_INVALID" for issue in issues)
