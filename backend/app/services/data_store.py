from __future__ import annotations

from pathlib import Path
from typing import Any, Dict

from .audit import AuditLogger
from .crypto import EncryptedJsonStore, KMSClient


class SensitiveDataStore:
    def __init__(self, path: Path, kms: KMSClient, audit_logger: AuditLogger) -> None:
        self.store = EncryptedJsonStore(path, kms, associated_data="sensitive-data")
        self.audit_logger = audit_logger

    def persist(self, key: str, payload: Dict[str, Any]) -> None:
        current = self.store.read()
        current[key] = payload
        self.store.write(current)
        self.audit_logger.log("data_store", "sensitive.persisted", {"key": key})

    def read(self, key: str) -> Dict[str, Any] | None:
        current = self.store.read()
        return current.get(key)
