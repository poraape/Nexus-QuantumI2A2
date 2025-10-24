from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Optional

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
)

from .storage import SecureBucketClient


@dataclass
class AuditLogger:
    log_path: Path
    bucket: SecureBucketClient
    private_key_path: Path
    _private_key: Optional[Ed25519PrivateKey] = field(init=False, default=None)

    def __post_init__(self) -> None:
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        self.private_key_path.parent.mkdir(parents=True, exist_ok=True)

    def _load_private_key(self) -> Ed25519PrivateKey:
        if self._private_key is not None:
            return self._private_key

        if self.private_key_path.exists():
            key_data = self.private_key_path.read_bytes()
            self._private_key = serialization.load_pem_private_key(key_data, password=None)
        else:
            self._private_key = Ed25519PrivateKey.generate()
            pem = self._private_key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.PKCS8,
                encryption_algorithm=serialization.NoEncryption(),
            )
            # Write atomically to avoid partial keys
            tmp_path = self.private_key_path.with_suffix(".tmp")
            tmp_path.write_bytes(pem)
            os.replace(tmp_path, self.private_key_path)
        return self._private_key

    def _public_key_b64(self) -> str:
        public_key = self._load_private_key().public_key()
        pem = public_key.public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        return pem.decode("utf-8")

    def log(self, actor: str, action: str, metadata: Dict[str, Any] | None = None) -> None:
        entry: Dict[str, Any] = {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "actor": actor,
            "action": action,
            "metadata": metadata or {},
            "public_key": self._public_key_b64(),
        }
        serialized_entry = json.dumps(entry, sort_keys=True).encode("utf-8")
        signature = self._load_private_key().sign(serialized_entry)
        record = {
            "entry": entry,
            "signature": signature.hex(),
        }
        line = json.dumps(record, sort_keys=True)
        with self.log_path.open("a", encoding="utf-8") as fh:
            fh.write(line + "\n")
        self.bucket.upload_file(self.log_path)
