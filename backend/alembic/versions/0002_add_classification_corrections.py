"""add classification corrections table

Revision ID: 0002
Revises: 0001
Create Date: 2025-02-23 00:00:00
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    operation_enum = sa.Enum(
        "Compra",
        "Venda",
        "Devolução",
        "Serviço",
        "Transferência",
        "Outros",
        name="operationtype",
    )
    operation_enum.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "classification_corrections",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("job_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("document_name", sa.String(length=255), nullable=False),
        sa.Column("operation_type", operation_enum, nullable=False),
        sa.Column("created_by", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
            server_onupdate=sa.func.now(),
        ),
        sa.UniqueConstraint("job_id", "document_name", name="uq_corrections_job_document"),
    )
    op.create_index("ix_classification_corrections_job_id", "classification_corrections", ["job_id"])


def downgrade() -> None:
    op.drop_index("ix_classification_corrections_job_id", table_name="classification_corrections")
    op.drop_table("classification_corrections")
    operation_enum = sa.Enum(name="operationtype")
    operation_enum.drop(op.get_bind(), checkfirst=True)

