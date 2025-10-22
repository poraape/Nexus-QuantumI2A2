"""create core tables

Revision ID: 0001
Revises: 
Create Date: 2024-01-01 00:00:00
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "documents",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("document_id", sa.String(length=64), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("content_type", sa.String(length=128), nullable=False),
        sa.Column("storage_path", sa.String(length=512), nullable=False),
        sa.Column("metadata", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("document_id"),
    )
    op.create_index("ix_documents_document_id", "documents", ["document_id"], unique=True)

    op.create_table(
        "items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("document_id", sa.Integer(), sa.ForeignKey("documents.id", ondelete="CASCADE")),
        sa.Column("sku", sa.String(length=64)),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("quantity", sa.Numeric(12, 3), nullable=False, server_default="0"),
        sa.Column("unit_price", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("total_value", sa.Numeric(12, 2), nullable=False, server_default="0"),
    )

    op.create_table(
        "audits",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("document_id", sa.Integer(), sa.ForeignKey("documents.id", ondelete="CASCADE")),
        sa.Column("passed", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("issues", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "classifications",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("document_id", sa.Integer(), sa.ForeignKey("documents.id", ondelete="CASCADE")),
        sa.Column("type", sa.String(length=64), nullable=False),
        sa.Column("sector", sa.String(length=64), nullable=False),
        sa.Column("confidence", sa.Numeric(5, 4), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "ledger_entries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("document_id", sa.Integer(), sa.ForeignKey("documents.id", ondelete="CASCADE")),
        sa.Column("account_code", sa.String(length=32), nullable=False),
        sa.Column("description", sa.String(length=255), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "jobs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("job_id", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="processing"),
        sa.Column("payload", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("result", sa.JSON()),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("job_id"),
    )
    op.create_index("ix_jobs_job_id", "jobs", ["job_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_jobs_job_id", table_name="jobs")
    op.drop_table("jobs")
    op.drop_table("ledger_entries")
    op.drop_table("classifications")
    op.drop_table("audits")
    op.drop_table("items")
    op.drop_index("ix_documents_document_id", table_name="documents")
    op.drop_table("documents")
