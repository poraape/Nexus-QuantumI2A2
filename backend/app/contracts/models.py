"""Pydantic contracts that describe API payloads shared with the SPA."""
from __future__ import annotations

from datetime import datetime
from typing import Dict, List, Optional, Union, Literal
from uuid import UUID

from pydantic import BaseModel, Field


AgentStatusLiteral = Literal["pending", "running", "completed", "error"]
JobStatusLiteral = Literal["queued", "running", "completed", "failed"]


class AgentProgressContract(BaseModel):
    step: Optional[str] = None
    current: Optional[int] = None
    total: Optional[int] = None
    extra: Dict[str, object] = Field(default_factory=dict)

    class Config:
        extra = "allow"


class AgentStateContract(BaseModel):
    status: AgentStatusLiteral
    progress: Optional[AgentProgressContract] = None
    details: Dict[str, object] = Field(default_factory=dict)

    class Config:
        extra = "allow"


class ChartDataPointContract(BaseModel):
    label: str
    value: float
    x: Optional[float] = None
    color: Optional[str] = None


class ChartDataContract(BaseModel):
    type: Literal["bar", "pie", "line", "scatter"]
    title: str
    data: List[ChartDataPointContract]
    options: Dict[str, object] = Field(default_factory=dict)
    xAxisLabel: Optional[str] = None
    yAxisLabel: Optional[str] = None


class ChatMessageContract(BaseModel):
    id: str
    sender: Union["user", "ai"]
    text: str
    chartData: Optional[ChartDataContract] = None


class KeyMetricContract(BaseModel):
    metric: str
    value: str
    insight: str


class AnalysisResultContract(BaseModel):
    title: str
    summary: str
    keyMetrics: List[KeyMetricContract]
    actionableInsights: List[str]
    strategicRecommendations: Optional[List[str]] = None


class ImportedDocContract(BaseModel):
    kind: Literal["NFE_XML", "CSV", "XLSX", "PDF", "IMAGE", "UNSUPPORTED"]
    name: str
    size: int
    status: Literal["parsed", "ocr_needed", "unsupported", "error"]
    data: Optional[List[Dict[str, Union[str, float, int]]]] = None
    text: Optional[str] = None
    meta: Optional[Dict[str, Union[str, float, int]]] = None
    error: Optional[str] = None


class InconsistencyContract(BaseModel):
    code: str
    message: str
    explanation: str
    normativeBase: Optional[str] = None
    severity: Literal["ERRO", "ALERTA", "INFO"]


class ClassificationResultContract(BaseModel):
    operationType: Literal["Compra", "Venda", "Devolução", "Serviço", "Transferência", "Outros"]
    businessSector: str
    confidence: float


class AuditedDocumentContract(BaseModel):
    doc: ImportedDocContract
    status: Literal["OK", "ALERTA", "ERRO"]
    score: Optional[float] = None
    inconsistencies: List[InconsistencyContract]
    classification: Optional[ClassificationResultContract] = None


class AccountingEntryContract(BaseModel):
    docName: str
    account: str
    type: Literal["D", "C"]
    value: float


class SpedFileContract(BaseModel):
    filename: str
    content: str


class CrossValidationDocumentContract(BaseModel):
    name: str
    value: Union[str, float, int]


class CrossValidationResultContract(BaseModel):
    attribute: str
    observation: str
    documents: List[CrossValidationDocumentContract]


class DeterministicDiscrepancyContract(BaseModel):
    valueA: Union[str, float, int]
    docA: Dict[str, Union[str, float, int]]
    valueB: Union[str, float, int]
    docB: Dict[str, Union[str, float, int]]
    ruleCode: str
    justification: str


class DeterministicContextSnapshotContract(BaseModel):
    ncm: str
    cfop: str
    emitenteCnpj: Optional[str] = None
    destinatarioCnpj: Optional[str] = None
    dataEmissao: Optional[str] = None
    produtoNome: Optional[str] = None


class DeterministicCrossValidationResultContract(BaseModel):
    comparisonKey: str
    attribute: str
    description: str
    discrepancies: List[DeterministicDiscrepancyContract]
    severity: Literal["ALERTA", "INFO"]
    ruleCode: str
    justification: str
    context: DeterministicContextSnapshotContract


class DeterministicArtifactDescriptorContract(BaseModel):
    executionId: str
    format: Literal["json", "csv", "md"]
    filename: str
    createdAt: str
    size: int


class AuditReportContract(BaseModel):
    summary: AnalysisResultContract
    documents: List[AuditedDocumentContract]
    aggregatedMetrics: Optional[Dict[str, Union[str, float, int]]] = None
    accountingEntries: Optional[List[AccountingEntryContract]] = None
    spedFile: Optional[SpedFileContract] = None
    aiDrivenInsights: Optional[List[Dict[str, object]]] = None
    crossValidationResults: Optional[List[CrossValidationResultContract]] = None
    deterministicCrossValidation: Optional[List[DeterministicCrossValidationResultContract]] = None
    deterministicArtifacts: Optional[List[DeterministicArtifactDescriptorContract]] = None
    executionId: Optional[str] = None


class AnalysisJobContract(BaseModel):
    jobId: UUID = Field(alias="jobId")
    status: JobStatusLiteral
    agentStates: Dict[str, AgentStateContract]
    error: Optional[str] = None
    result: Optional[AuditReportContract] = None
    createdAt: Optional[datetime] = Field(default=None, alias="createdAt")
    updatedAt: Optional[datetime] = Field(default=None, alias="updatedAt")

    class Config:
        allow_population_by_field_name = True
