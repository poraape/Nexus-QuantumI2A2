"""Modelos Pydantic compartilhados."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class DocumentItem(BaseModel):
    sku: Optional[str] = Field(None, description="SKU/NCM do item")
    description: str = Field(..., description="Descrição do produto")
    quantity: float = Field(..., ge=0, description="Quantidade do item")
    unit_price: float = Field(..., ge=0, description="Preço unitário")
    total_value: float = Field(..., ge=0, description="Valor total do item")


class DocumentTotals(BaseModel):
    items_total: float = Field(..., ge=0)
    taxes_total: float = Field(default=0, ge=0)
    grand_total: float = Field(..., ge=0)


class DocumentIn(BaseModel):
    document_id: str = Field(..., description="Identificador do documento de entrada")
    filename: str = Field(...)
    content_type: str = Field(...)
    storage_path: str = Field(...)
    metadata: dict[str, Any] = Field(default_factory=dict)


class Document(DocumentIn):
    extracted_at: datetime = Field(default_factory=datetime.utcnow)
    items: List[DocumentItem] = Field(default_factory=list)
    totals: DocumentTotals = Field(...)


class AuditIssue(BaseModel):
    code: str
    message: str
    severity: str = Field(default="info")


class AuditReport(BaseModel):
    document_id: str
    document: Optional["Document"] = Field(default=None, description="Documento analisado com totais")
    issues: List[AuditIssue] = Field(default_factory=list)
    passed: bool = Field(default=True)
    audited_at: datetime = Field(default_factory=datetime.utcnow)


class ClassificationResult(BaseModel):
    document_id: str
    type: str
    sector: str
    confidence: float = Field(default=1.0, ge=0, le=1)
    document: Optional["Document"] = Field(
        default=None, description="Documento associado para continuidade do pipeline"
    )


class AccountingOutput(BaseModel):
    document_id: str
    ledger_entries: List[dict[str, Any]] = Field(default_factory=list)
    sped_files: List[str] = Field(default_factory=list)
    generated_at: datetime = Field(default_factory=datetime.utcnow)
    document: Optional["Document"] = Field(
        default=None, description="Documento original com totais recalculados"
    )
    totals: Optional[DocumentTotals] = Field(
        default=None, description="Totais agregados apos validacao contabil"
    )


class InsightReference(BaseModel):
    description: str
    exists: bool = Field(default=True)


class InsightReport(BaseModel):
    document_id: str
    title: str
    summary: str
    provenance: List[InsightReference] = Field(default_factory=list)
    recommendations: List[str] = Field(default_factory=list)


class OrchestratorEvent(BaseModel):
    event_id: str
    document_id: str
    status: str
    payload: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class CrossValidationFinding(BaseModel):
    code: str = Field(..., description="Identificador da regra disparada")
    message: str = Field(..., description="Mensagem de inconsistência detectada")
    severity: str = Field(default="warning", description="Nível de severidade")
    context: Dict[str, Any] = Field(default_factory=dict, description="Contexto adicional")


class CrossValidationReport(BaseModel):
    document_id: str
    operations: List[Dict[str, Any]] = Field(default_factory=list)
    findings: List[CrossValidationFinding] = Field(default_factory=list)
    generated_at: datetime = Field(default_factory=datetime.utcnow)

    @property
    def has_findings(self) -> bool:
        return bool(self.findings)


__all__ = [
    "DocumentIn",
    "Document",
    "DocumentItem",
    "DocumentTotals",
    "AuditReport",
    "AuditIssue",
    "ClassificationResult",
    "AccountingOutput",
    "InsightReport",
    "InsightReference",
    "OrchestratorEvent",
    "CrossValidationReport",
    "CrossValidationFinding",
]
