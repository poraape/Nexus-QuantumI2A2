"""Agente de auditoria."""
from __future__ import annotations

from app.agents.base import Agent, retryable
from app.rules import engine
from app.schemas import AuditReport, Document


class AuditorAgent(Agent):
    name = "auditor"

    @retryable
    def run(self, document: Document) -> AuditReport:
        def _execute() -> AuditReport:
            issues = list(engine.validate_document(document))
            passed = not any(issue.severity == "error" for issue in issues)
            return AuditReport(
                document_id=document.document_id,
                document=document,
                issues=issues,
                passed=passed,
            )

        return self._execute_with_metrics(_execute)
