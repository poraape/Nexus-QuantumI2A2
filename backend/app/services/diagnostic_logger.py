from __future__ import annotations

import json
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, MutableMapping, Optional

from pydantic import BaseModel

from ..utils import model_dump

LOG_PATH = Path("artifacts/logs/totals_diagnostic.json")
FIX_REPORT_PATH = Path("artifacts/fix_reports/null_total_correction.json")
BENCHMARK_PATH = Path("artifacts/fix_reports/post_validation_benchmark.json")


def _serialize_totals(totals: Optional[Any]) -> Optional[dict[str, Any]]:
    if totals is None:
        return None
    if isinstance(totals, BaseModel):
        return model_dump(totals)
    if isinstance(totals, Mapping):
        return dict(totals)
    if hasattr(totals, "__dict__"):
        return {
            key: value
            for key, value in vars(totals).items()
            if not key.startswith("_")
        }
    return None


def log_totals_event(
    *,
    agent: str,
    stage: str,
    document_id: Optional[str],
    totals: Optional[Any],
    status: str,
    extra: Optional[Mapping[str, Any]] = None,
) -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    event = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "agent": agent,
        "stage": stage,
        "document_id": document_id,
        "status": status,
        "totals": _serialize_totals(totals),
        "extra": dict(extra or {}),
    }
    with LOG_PATH.open("a", encoding="utf-8") as log_file:
        log_file.write(json.dumps(event, ensure_ascii=False) + "\n")


def append_fix_report(
    *,
    document_id: str,
    old_totals: Optional[Any],
    new_totals: Optional[Any],
    duration_ms: float,
    status: str,
) -> None:
    FIX_REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    entry = {
        "document_id": document_id,
        "old_totals": _serialize_totals(old_totals),
        "new_totals": _serialize_totals(new_totals),
        "time_ms_recompute": round(duration_ms, 2),
        "status": status,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    if FIX_REPORT_PATH.exists():
        try:
            data = json.loads(FIX_REPORT_PATH.read_text(encoding="utf-8"))
            if not isinstance(data, list):
                data = []
        except json.JSONDecodeError:
            data = []
    else:
        data = []
    data.append(entry)
    FIX_REPORT_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def update_post_validation_benchmark(
    *,
    document_id: str,
    totals: Optional[Any],
    notes: Optional[str] = None,
) -> None:
    BENCHMARK_PATH.parent.mkdir(parents=True, exist_ok=True)
    summary_entry: MutableMapping[str, Any] = {
        "document_id": document_id,
        "totals": _serialize_totals(totals),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if notes:
        summary_entry["notes"] = notes

    if BENCHMARK_PATH.exists():
        try:
            existing = json.loads(BENCHMARK_PATH.read_text(encoding="utf-8"))
            if not isinstance(existing, list):
                existing = []
        except json.JSONDecodeError:
            existing = []
    else:
        existing = []

    existing = [entry for entry in existing if entry.get("document_id") != document_id]
    existing.append(summary_entry)

    BENCHMARK_PATH.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")


def timestamp_ms() -> int:
    return int(time.perf_counter() * 1000)
