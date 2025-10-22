from __future__ import annotations

import base64
import json
import os
import secrets
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


class KMSClient:
    """Simple AES-256-GCM based KMS wrapper."""

    def __init__(self, master_key_b64: str):
        try:
            self._master_key = base64.urlsafe_b64decode(master_key_b64)
        except Exception as exc:  # noqa: BLE001
            raise ValueError('Invalid base64 master key for KMS.') from exc

        if len(self._master_key) != 32:
            raise ValueError('KMS master key must be 32 bytes for AES-256.')

    def encrypt(self, data: bytes, associated_data: bytes | None = None) -> str:
        nonce = os.urandom(12)
        aesgcm = AESGCM(self._master_key)
        ciphertext = aesgcm.encrypt(nonce, data, associated_data)
        payload = nonce + ciphertext
        return base64.urlsafe_b64encode(payload).decode('utf-8')

    def decrypt(self, token: str, associated_data: bytes | None = None) -> bytes:
        payload = base64.urlsafe_b64decode(token)
        nonce, ciphertext = payload[:12], payload[12:]
        aesgcm = AESGCM(self._master_key)
        return aesgcm.decrypt(nonce, ciphertext, associated_data)


@dataclass
class SecretVault:
    path: Path
    kms: KMSClient

    def store_secret(self, name: str, value: str) -> None:
        secrets_data = self._load_all()
        encrypted_value = self.kms.encrypt(value.encode('utf-8'), name.encode('utf-8'))
        secrets_data[name] = encrypted_value
        self._write(secrets_data)

    def get_secret(self, name: str) -> str | None:
        secrets_data = self._load_all()
        encrypted = secrets_data.get(name)
        if not encrypted:
            return None
        decrypted = self.kms.decrypt(encrypted, name.encode('utf-8'))
        return decrypted.decode('utf-8')

    def _load_all(self) -> Dict[str, str]:
        if not self.path.exists():
            return {}
        try:
            content = self.path.read_text(encoding='utf-8')
            return json.loads(content)
        except json.JSONDecodeError:
            raise ValueError('Vault content is corrupted.')

    def _write(self, data: Dict[str, str]) -> None:
        tmp_path = self.path.with_suffix('.tmp')
        tmp_path.write_text(json.dumps(data, sort_keys=True), encoding='utf-8')
        tmp_path.replace(self.path)


class EncryptedJsonStore:
    """Utility to store JSON data encrypted at rest."""

    def __init__(self, path: Path, kms: KMSClient, associated_data: str):
        self.path = path
        self.kms = kms
        self.associated_data = associated_data.encode('utf-8')

    def read(self) -> Dict[str, Any]:
        if not self.path.exists():
            return {}
        token = self.path.read_text(encoding='utf-8')
        if not token:
            return {}
        payload = self.kms.decrypt(token, self.associated_data)
        return json.loads(payload.decode('utf-8'))

    def write(self, value: Dict[str, Any]) -> None:
        serialized = json.dumps(value, sort_keys=True).encode('utf-8')
        encrypted = self.kms.encrypt(serialized, self.associated_data)
        tmp_path = self.path.with_suffix('.tmp')
        tmp_path.write_text(encrypted, encoding='utf-8')
        tmp_path.replace(self.path)


def generate_data_encryption_key() -> str:
    """Generate a new random encryption key encoded in URL-safe base64."""
    return base64.urlsafe_b64encode(secrets.token_bytes(32)).decode('utf-8')
