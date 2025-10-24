"""Secure file storage utilities."""
from __future__ import annotations

import secrets
from typing import Iterable, List, Tuple

from fastapi import UploadFile

from .config import get_settings
from .database import get_session
from .models import StoredFile

settings = get_settings()

ALLOWED_CONTENT_TYPES = {
    "application/pdf",
    "text/csv",
    "text/plain",
    "application/zip",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}


def _safe_filename(filename: str) -> str:
    token = secrets.token_hex(8)
    sanitized = filename.replace("..", "").replace("/", "_").replace("\\", "_")
    return f"{token}_{sanitized}"


def store_uploads(job_id, files: Iterable[UploadFile]) -> List[StoredFile]:
    stored: List[StoredFile] = []
    base_path = settings.storage_path / str(job_id)
    base_path.mkdir(parents=True, exist_ok=True)

    with get_session() as session:
        for upload in files:
            content_type = upload.content_type or "application/octet-stream"
            if content_type not in ALLOWED_CONTENT_TYPES:
                raise ValueError(f"Tipo de arquivo '{content_type}' não é permitido.")

            safe_name = _safe_filename(upload.filename or "arquivo")
            target_path = base_path / safe_name
            data = upload.file.read()
            target_path.write_bytes(data)

            stored_file = StoredFile(
                job_id=job_id,
                filename=safe_name,
                content_type=content_type,
                path=str(target_path.resolve()),
            )
            session.add(stored_file)
            session.flush()
            session.refresh(stored_file)
            stored.append(stored_file)

    return stored


def list_files(job_id) -> List[Tuple[str, str]]:
    with get_session() as session:
        results = session.query(StoredFile).filter(StoredFile.job_id == job_id).all()
        return [(stored.path, stored.content_type or "application/octet-stream") for stored in results]
