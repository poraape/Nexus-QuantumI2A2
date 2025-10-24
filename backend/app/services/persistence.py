"""Persistence helpers for pipeline artifacts."""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Dict, Iterable, List

from ..config import get_settings
from ..orchestrator.state_machine import PipelineRunResult
from ..utils import model_dump

try:  # pragma: no cover - optional dependency
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session, sessionmaker

    from ..db.models import Audit, Document as DocumentModel, Item, LedgerEntry
    from ..db.session import Base as DbBase

    SQLALCHEMY_AVAILABLE = True
except ModuleNotFoundError:  # pragma: no cover - fallback for lightweight environments
    SQLALCHEMY_AVAILABLE = False


_settings = get_settings()

if SQLALCHEMY_AVAILABLE:
    _engine = create_engine(_settings.database_url, future=True, echo=False)
    _SessionLocal = sessionmaker(bind=_engine, expire_on_commit=False, future=True)
    DbBase.metadata.create_all(_engine)

    @contextmanager
    def pipeline_session() -> Iterable[Session]:
        session: Session = _SessionLocal()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def _persist_document(session: Session, result: PipelineRunResult) -> DocumentModel:
        document_schema = result.document
        metadata = dict(document_schema.metadata)
        metadata.setdefault("totals", model_dump(document_schema.totals))

        document_model = DocumentModel(
            document_id=document_schema.document_id,
            filename=document_schema.filename,
            content_type=document_schema.content_type,
            storage_path=document_schema.storage_path,
            metadata=metadata,
        )
        session.add(document_model)
        session.flush()

        for item in document_schema.items:
            session.add(
                Item(
                    document_id=document_model.id,
                    sku=item.sku,
                    description=item.description,
                    quantity=float(item.quantity),
                    unit_price=float(item.unit_price),
                    total_value=float(item.total_value),
                )
            )

        return document_model

    def _persist_audit(session: Session, document: DocumentModel, result: PipelineRunResult) -> None:
        audit_report = result.audit
        session.add(
            Audit(
                document_id=document.id,
                passed=audit_report.passed,
                issues={"issues": [model_dump(issue) for issue in audit_report.issues]},
            )
        )

    def _persist_ledger_entries(session: Session, document: DocumentModel, result: PipelineRunResult) -> None:
        for entry in result.accounting.ledger_entries:
            session.add(
                LedgerEntry(
                    document_id=document.id,
                    account_code=str(entry.get("account_code", "1.1.1")),
                    description=str(entry.get("description", "")),
                    amount=float(entry.get("amount", 0.0)),
                )
            )

    def _persist_icms_entries(session: Session, document: DocumentModel, icms_payload: Dict[str, object]) -> None:
        entries: List[Dict[str, object]] = icms_payload.get("entries", [])  # type: ignore[assignment]
        for entry in entries:
            session.add(
                LedgerEntry(
                    document_id=document.id,
                    account_code="ICMS",
                    description=f"ICMS {entry.get('uf')} {entry.get('ncm')}",
                    amount=float(entry.get("tax_amount", 0.0)),
                )
            )

    def persist_pipeline_artifacts(result: PipelineRunResult, icms_payload: Dict[str, object]) -> Dict[str, object]:
        """Persist extracted artifacts and return database identifiers."""

        with pipeline_session() as session:
            document_model = _persist_document(session, result)
            _persist_audit(session, document_model, result)
            _persist_ledger_entries(session, document_model, result)
            _persist_icms_entries(session, document_model, icms_payload)
            session.flush()
            return {"document_id": document_model.id}

else:
    _db_path = Path(_settings.database_url.replace("sqlite:///", "")).resolve()
    _db_path.parent.mkdir(parents=True, exist_ok=True)

    def _connect() -> sqlite3.Connection:
        conn = sqlite3.connect(_db_path)
        conn.row_factory = sqlite3.Row
        return conn

    with _connect() as _conn:
        _conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS documents (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                document_id TEXT UNIQUE,
                filename TEXT,
                content_type TEXT,
                storage_path TEXT,
                metadata TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                document_id INTEGER,
                sku TEXT,
                description TEXT,
                quantity REAL,
                unit_price REAL,
                total_value REAL
            );
            CREATE TABLE IF NOT EXISTS audits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                document_id INTEGER,
                passed INTEGER,
                issues TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS ledger_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                document_id INTEGER,
                account_code TEXT,
                description TEXT,
                amount REAL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
            """
        )

    def persist_pipeline_artifacts(result: PipelineRunResult, icms_payload: Dict[str, object]) -> Dict[str, object]:
        """Persist artifacts using a lightweight sqlite3 fallback."""

        document = result.document
        metadata = dict(document.metadata)
        metadata.setdefault("totals", model_dump(document.totals))
        metadata_json = json.dumps(metadata, ensure_ascii=False)

        with _connect() as conn:
            cursor = conn.execute(
                "INSERT INTO documents (document_id, filename, content_type, storage_path, metadata) VALUES (?, ?, ?, ?, ?)",
                (
                    document.document_id,
                    document.filename,
                    document.content_type,
                    document.storage_path,
                    metadata_json,
                ),
            )
            document_pk = cursor.lastrowid
            for item in document.items:
                conn.execute(
                    "INSERT INTO items (document_id, sku, description, quantity, unit_price, total_value) VALUES (?, ?, ?, ?, ?, ?)",
                    (
                        document_pk,
                        item.sku,
                        item.description,
                        float(item.quantity),
                        float(item.unit_price),
                        float(item.total_value),
                    ),
                )

            issues_payload = {"issues": [model_dump(issue) for issue in result.audit.issues]}
            conn.execute(
                "INSERT INTO audits (document_id, passed, issues) VALUES (?, ?, ?)",
                (document_pk, int(result.audit.passed), json.dumps(issues_payload, ensure_ascii=False)),
            )

            for entry in result.accounting.ledger_entries:
                conn.execute(
                    "INSERT INTO ledger_entries (document_id, account_code, description, amount) VALUES (?, ?, ?, ?)",
                    (
                        document_pk,
                        str(entry.get("account_code", "1.1.1")),
                        str(entry.get("description", "")),
                        float(entry.get("amount", 0.0)),
                    ),
                )

            for entry in icms_payload.get("entries", []):
                conn.execute(
                    "INSERT INTO ledger_entries (document_id, account_code, description, amount) VALUES (?, ?, ?, ?)",
                    (
                        document_pk,
                        "ICMS",
                        f"ICMS {entry.get('uf')} {entry.get('ncm')}",
                        float(entry.get("tax_amount", 0.0)),
                    ),
                )

        return {"document_id": document_pk}
