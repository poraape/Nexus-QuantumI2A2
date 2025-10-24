from __future__ import annotations

import asyncio
import time
import uuid
from collections import defaultdict, deque
from typing import Deque, Dict

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response
from starlette.status import HTTP_429_TOO_MANY_REQUESTS

from .services.audit import AuditLogger


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Simple in-memory sliding window rate limiter."""

    def __init__(self, app, limit: int, window_seconds: int) -> None:  # type: ignore[override]
        super().__init__(app)
        self._limit = max(1, limit)
        self._window = max(1, window_seconds)
        self._hits: Dict[str, Deque[float]] = defaultdict(deque)
        self._lock = asyncio.Lock()

    def _identifier(self, request: Request) -> str:
        forwarded_for = request.headers.get("X-Forwarded-For")
        if forwarded_for:
            return forwarded_for.split(",")[0].strip()
        if request.client and request.client.host:
            return request.client.host
        return "anonymous"

    async def dispatch(self, request: Request, call_next):  # type: ignore[override]
        identifier = self._identifier(request)
        now = time.monotonic()
        async with self._lock:
            bucket = self._hits[identifier]
            while bucket and (now - bucket[0]) > self._window:
                bucket.popleft()
            if len(bucket) >= self._limit:
                return Response(
                    status_code=HTTP_429_TOO_MANY_REQUESTS,
                    media_type="application/json",
                    content='{"detail": "Too many requests."}',
                    headers={"Retry-After": str(self._window)},
                )
            bucket.append(now)

        response = await call_next(request)
        return response


class AuditMiddleware(BaseHTTPMiddleware):
    """Records request metadata in the audit log and propagates correlation IDs."""

    def __init__(self, app, audit_logger: AuditLogger) -> None:  # type: ignore[override]
        super().__init__(app)
        self._logger = audit_logger

    async def dispatch(self, request: Request, call_next):  # type: ignore[override]
        if request.url.path == "/health":
            return await call_next(request)

        correlation_id = request.headers.get("X-Correlation-ID") or str(uuid.uuid4())
        request.state.correlation_id = correlation_id
        start_time = time.perf_counter()

        try:
            response = await call_next(request)
        except Exception:
            duration_ms = (time.perf_counter() - start_time) * 1000
            self._logger.log(
                "http",
                "request.failed",
                {
                    "path": request.url.path,
                    "method": request.method,
                    "status": 500,
                    "duration_ms": round(duration_ms, 2),
                    "correlation_id": correlation_id,
                    "client": getattr(request.client, "host", None),
                },
            )
            raise

        duration_ms = (time.perf_counter() - start_time) * 1000
        response.headers["X-Correlation-ID"] = correlation_id
        self._logger.log(
            "http",
            "request.completed",
            {
                "path": request.url.path,
                "method": request.method,
                "status": response.status_code,
                "duration_ms": round(duration_ms, 2),
                "correlation_id": correlation_id,
                "client": getattr(request.client, "host", None),
            },
        )
        return response
