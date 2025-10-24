from __future__ import annotations

import uuid

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.crud import list_corrections, upsert_correction
from app.database import Base
from app.models import OperationType


def test_upsert_and_list_corrections() -> None:
    engine = create_engine("sqlite:///:memory:", future=True)
    TestingSession = sessionmaker(bind=engine, future=True)
    Base.metadata.create_all(engine)

    job_id = uuid.uuid4()

    with TestingSession() as session:
        inserted = upsert_correction(session, job_id, "doc-1.xml", OperationType.COMPRA, "user-a")
        assert inserted.operation_type is OperationType.COMPRA
        assert inserted.created_by == "user-a"

        updated = upsert_correction(session, job_id, "doc-1.xml", OperationType.VENDA, "user-b")
        assert updated.operation_type is OperationType.VENDA
        assert updated.created_by == "user-b"

        corrections = list_corrections(session, job_id)
        assert len(corrections) == 1
        assert corrections[0].operation_type is OperationType.VENDA
        assert corrections[0].created_by == "user-b"

