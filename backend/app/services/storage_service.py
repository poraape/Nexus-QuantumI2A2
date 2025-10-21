"""Serviço de armazenamento MinIO simplificado."""
from __future__ import annotations

from pathlib import Path


def save_local(path: str, data: bytes) -> str:
    file_path = Path(path)
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_bytes(data)
    return str(file_path)
