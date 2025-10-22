from __future__ import annotations

import re
from typing import Dict, Iterable, List

from .audit import AuditLogger

CPF_PATTERN = re.compile(r"(\d{3})(\d{3})(\d{3})(\d{2})")
CNPJ_PATTERN = re.compile(r"(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})")


class IdentifierMasker:
    def __init__(self, audit_logger: AuditLogger) -> None:
        self.audit_logger = audit_logger

    def mask_value(self, value: str) -> str:
        digits = re.sub(r"\D", "", value)
        if len(digits) == 11:
            match = CPF_PATTERN.fullmatch(digits)
            if match:
                return f"{match.group(1)}.{match.group(2)}.***-**"
        if len(digits) == 14:
            match = CNPJ_PATTERN.fullmatch(digits)
            if match:
                return f"{match.group(1)}.{match.group(2)}.{match.group(3)}/****-{match.group(5)}"
        return value

    def sanitize_records(self, records: Iterable[Dict[str, object]]) -> List[Dict[str, object]]:
        sanitized: List[Dict[str, object]] = []
        for record in records:
            new_record: Dict[str, object] = {}
            for key, value in record.items():
                if isinstance(value, str) and ('cnpj' in key.lower() or 'cpf' in key.lower()):
                    new_record[key] = self.mask_value(value)
                else:
                    new_record[key] = value
            sanitized.append(new_record)
        self.audit_logger.log('masking_service', 'identifiers.sanitized', {'count': len(sanitized)})
        return sanitized
