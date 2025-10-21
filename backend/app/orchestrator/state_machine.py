"""Orquestrador simples encadeando agentes."""
from __future__ import annotations

from app.agents.accountant import AccountantAgent
from app.agents.auditor import AuditorAgent
from app.agents.classifier import ClassifierAgent
from app.agents.extractor import ExtractorAgent
from app.agents.intelligence import IntelligenceAgent
from app.schemas import DocumentIn, InsightReport


class PipelineOrchestrator:
    def __init__(self) -> None:
        self.extractor = ExtractorAgent()
        self.auditor = AuditorAgent()
        self.classifier = ClassifierAgent()
        self.accountant = AccountantAgent()
        self.intelligence = IntelligenceAgent()

    def run(self, document_in: DocumentIn) -> InsightReport:
        document = self.extractor.run(document_in)
        audit = self.auditor.run(document)
        classification = self.classifier.run(audit)
        accounting = self.accountant.run(classification)
        insights = self.intelligence.run(accounting)
        return insights


def build_pipeline() -> PipelineOrchestrator:
    return PipelineOrchestrator()
