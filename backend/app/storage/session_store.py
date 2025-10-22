from __future__ import annotations

import datetime as dt
import json
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

EXPORT_ROOT = Path("exports")
EXPORT_ROOT.mkdir(parents=True, exist_ok=True)


def _bundle_path(bundle_id: str) -> Path:
    return EXPORT_ROOT / f"{bundle_id}.json"


def save_bundle(payload: Dict[str, Any]) -> str:
    bundle_id = f"{dt.datetime.utcnow().strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:8]}"
    path = _bundle_path(bundle_id)

    bundle = {
        "bundle_id": bundle_id,
        "saved_at": dt.datetime.utcnow().isoformat(),
        **payload,
    }

    path.write_text(json.dumps(bundle, ensure_ascii=False, indent=2), encoding="utf-8")
    return bundle_id


def load_bundle(bundle_id: str) -> Optional[Dict[str, Any]]:
    path = _bundle_path(bundle_id)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def list_bundles() -> List[str]:
    return sorted(
        path.stem
        for path in EXPORT_ROOT.glob("*.json")
        if path.is_file()
    )


def aggregate_bundles() -> Dict[str, Any]:
    bundle_ids = list_bundles()
    bundles = [load_bundle(bundle_id) for bundle_id in bundle_ids]
    filtered = [bundle for bundle in bundles if bundle is not None]
    return {
        "generated_at": dt.datetime.utcnow().isoformat(),
        "bundle_ids": bundle_ids,
        "bundles": filtered,
    }
