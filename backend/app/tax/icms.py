"""ICMS tax computation with caching and reporting helpers."""
from __future__ import annotations

import datetime as dt
import json
import logging
import threading
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Mapping, Tuple

logger = logging.getLogger("app.tax.icms")


@dataclass(frozen=True)
class ICMSRate:
    """Represents an ICMS tax rate entry."""

    uf: str
    ncm: str
    rate: float


_DEFAULT_TABLE_VERSION = "2024.05"
_DEFAULT_TABLE_SOURCE = "ANP/SEFAZ cached dataset"
_DEFAULT_TABLE: Dict[str, Dict[str, float]] = {
    "SP": {
        "27101932": 0.125,
        "87032310": 0.14,
        "DEFAULT": 0.18,
    },
    "RJ": {
        "27101932": 0.14,
        "30049099": 0.19,
        "DEFAULT": 0.20,
    },
    "MG": {
        "27101932": 0.155,
        "DEFAULT": 0.18,
    },
    "DEFAULT": {
        "DEFAULT": 0.17,
    },
}


class _ICMSCache:
    """Caches ICMS tables in-memory with an expiration policy."""

    def __init__(self, ttl_hours: int = 24) -> None:
        self._ttl = dt.timedelta(hours=ttl_hours)
        self._lock = threading.Lock()
        self._snapshot: Tuple[dt.datetime, Dict[str, Dict[str, float]]] | None = None

    def _is_expired(self, loaded_at: dt.datetime) -> bool:
        return dt.datetime.utcnow() - loaded_at >= self._ttl

    def _load_table(self) -> Dict[str, Dict[str, float]]:
        # In a production setting this would hydrate from ANP/SEFAZ APIs.
        return json.loads(json.dumps(_DEFAULT_TABLE))

    def snapshot(self) -> Tuple[Dict[str, Dict[str, float]], Dict[str, str]]:
        with self._lock:
            if self._snapshot is None or self._is_expired(self._snapshot[0]):
                table = self._load_table()
                self._snapshot = (dt.datetime.utcnow(), table)
                logger.info("ICMS table refreshed", extra={"version": _DEFAULT_TABLE_VERSION})
            loaded_at, table = self._snapshot
        metadata = {
            "version": _DEFAULT_TABLE_VERSION,
            "source": _DEFAULT_TABLE_SOURCE,
            "loaded_at": loaded_at.isoformat() + "Z",
            "valid_until": (loaded_at + self._ttl).isoformat() + "Z",
        }
        return table, metadata


class ICMSTaxService:
    """Service that exposes ICMS calculations with caching support."""

    def __init__(self, cache: _ICMSCache | None = None) -> None:
        self._cache = cache or _ICMSCache()

    @staticmethod
    def _normalise_ncm(ncm: str) -> str:
        return ncm.replace(".", "").strip().upper()

    def get_rate(self, uf: str, ncm: str) -> Tuple[float, Dict[str, str]]:
        table, metadata = self._cache.snapshot()
        uf_key = uf.strip().upper() if uf else "DEFAULT"
        ncm_key = self._normalise_ncm(ncm) if ncm else "DEFAULT"
        uf_table = table.get(uf_key) or table["DEFAULT"]
        rate = uf_table.get(ncm_key, uf_table.get("DEFAULT", table["DEFAULT"]["DEFAULT"]))
        return rate, metadata

    def calculate_entry(self, uf: str, ncm: str, base_value: float) -> Tuple[Dict[str, object], Dict[str, str]]:
        rate, metadata = self.get_rate(uf, ncm)
        amount = round(float(base_value or 0.0) * rate, 2)
        entry = {
            "uf": uf.upper() if uf else "DEFAULT",
            "ncm": self._normalise_ncm(ncm) if ncm else "DEFAULT",
            "rate": rate,
            "tax_amount": amount,
            "base_value": float(base_value or 0.0),
        }
        return entry, metadata

    def calculate_for_operations(self, operations: Iterable[Mapping[str, object]]) -> Dict[str, object]:
        entries: List[Dict[str, object]] = []
        metadata: Dict[str, str] | None = None
        for operation in operations:
            uf = str(operation.get("uf", "DEFAULT"))
            ncm = str(operation.get("ncm", "DEFAULT"))
            base_value = float(operation.get("value", 0.0) or 0.0)
            entry, metadata = self.calculate_entry(uf, ncm, base_value)
            entry["operation_id"] = operation.get("id") or operation.get("document")
            entries.append(entry)
        if metadata is None:
            _, metadata = self.get_rate("DEFAULT", "DEFAULT")
        total_tax = round(sum(item["tax_amount"] for item in entries), 2)
        return {
            "metadata": metadata,
            "entries": entries,
            "totals": {
                "tax_amount": total_tax,
                "operations": len(entries),
            },
        }

    def write_report(self, job_id: uuid.UUID, payload: Dict[str, object], base_path: Path | None = None) -> Path:
        output_dir = base_path or Path("reports") / "sped"
        output_dir.mkdir(parents=True, exist_ok=True)
        metadata = payload.get("metadata", {})
        report_body = {
            "job_id": str(job_id),
            "generated_at": dt.datetime.utcnow().isoformat() + "Z",
            "icms_version": metadata.get("version"),
            "icms_valid_until": metadata.get("valid_until"),
            "entries": payload.get("entries", []),
            "totals": payload.get("totals", {}),
            "source": metadata.get("source"),
        }
        report_path = output_dir / f"icms_{job_id}.json"
        report_path.write_text(json.dumps(report_body, ensure_ascii=False, indent=2))

        log_path = output_dir / "icms_versions.log"
        with log_path.open("a", encoding="utf-8") as log_file:
            log_file.write(
                json.dumps(
                    {
                        "job_id": str(job_id),
                        "version": metadata.get("version"),
                        "timestamp": report_body["generated_at"],
                    }
                )
                + "\n"
            )
        logger.info(
            "ICMS report generated",
            extra={
                "job_id": str(job_id),
                "version": metadata.get("version"),
                "entries": len(payload.get("entries", [])),
            },
        )
        return report_path


def calculate_icms_for_operations(operations: Iterable[Mapping[str, object]]) -> Dict[str, object]:
    """Convenience wrapper that proxies to the shared ICMS service."""

    return icms_service.calculate_for_operations(operations)


icms_service = ICMSTaxService()
