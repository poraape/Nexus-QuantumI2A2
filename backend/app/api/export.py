from __future__ import annotations

from fastapi import APIRouter, HTTPException, Response

from app.storage.session_store import aggregate_bundles, load_bundle, save_bundle

router = APIRouter(prefix="/export", tags=["export"])


@router.post("/bundle")
async def create_bundle(payload: dict) -> dict:
    bundle_id = save_bundle(payload)
    return {"bundle_id": bundle_id}


@router.get("/bundle/{bundle_id}")
async def get_bundle(bundle_id: str) -> dict:
    bundle = load_bundle(bundle_id)
    if bundle is None:
        raise HTTPException(status_code=404, detail="Bundle not found")
    return bundle


@router.get("/full")
async def export_full() -> Response:
    content = aggregate_bundles()
    return Response(
        content=json_dumps(content),
        media_type="application/json",
        headers={"Content-Disposition": 'attachment; filename="chat_full_export.json"'},
    )


def json_dumps(data: dict) -> str:
    import json

    return json.dumps(data, ensure_ascii=False, indent=2)
