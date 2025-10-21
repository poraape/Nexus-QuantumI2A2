"""Script simples para popular dados básicos."""
from __future__ import annotations

from app.db.models import Document
from app.db.session import SessionLocal


def main() -> None:
    session = SessionLocal()
    try:
        if session.query(Document).count() == 0:
            doc = Document(
                document_id="demo-1",
                filename="demo.xml",
                content_type="application/xml",
                storage_path="s3://nexus/demo.xml",
                metadata={},
            )
            session.add(doc)
            session.commit()
            print("Seed executado com sucesso.")
        else:
            print("Base já possui dados.")
    finally:
        session.close()


if __name__ == "__main__":
    main()
