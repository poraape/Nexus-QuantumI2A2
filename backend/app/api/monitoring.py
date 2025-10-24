"""Monitoring endpoints exposing collected runtime metrics."""
from __future__ import annotations

from typing import Dict

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse, PlainTextResponse

from app.services.monitoring.metrics_collector import metrics_collector


router = APIRouter(prefix="/monitoring", tags=["monitoring"])


def _build_csv(payload: Dict[str, object]) -> str:
    metrics: Dict[str, Dict[str, object]] = payload.get("metrics", {})  # type: ignore[assignment]
    adjustments: Dict[str, list[Dict[str, object]]] = payload.get("adjustments", {})  # type: ignore[assignment]
    headers = [
        "agent",
        "average_latency_ms",
        "error_rate",
        "throughput",
        "successes",
        "errors",
        "retries",
        "last_latency_ms",
        "last_updated",
        "adjustments",
    ]
    rows = [",".join(headers)]
    for agent, metric in metrics.items():
        adjustment_actions = ";".join(
            decision.get("action", "") for decision in adjustments.get(agent, [])
        )
        rows.append(
            ",".join(
                str(
                    metric.get(column)
                    if column != "adjustments"
                    else adjustment_actions
                )
                for column in headers
            )
        )
    return "\n".join(rows)


@router.get("/metrics")
async def fetch_metrics(
    format: str = Query("json", pattern="^(json|csv)$"),
    download: bool = Query(False, description="Força o download do arquivo"),
):
    payload = metrics_collector.export_payload()
    if format == "csv":
        csv_content = _build_csv(payload)
        response = PlainTextResponse(content=csv_content, media_type="text/csv")
        if download:
            response.headers["Content-Disposition"] = 'attachment; filename="metrics.csv"'
        return response

    response = JSONResponse(content=payload)
    if download:
        response.headers["Content-Disposition"] = 'attachment; filename="metrics.json"'
    return response

