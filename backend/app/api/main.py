"""Aplicação FastAPI principal do Nexus-QuantumI2A2."""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import audit, export


def create_app() -> FastAPI:
    app = FastAPI(title="Nexus Quantum API", version="0.1.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(export.router, prefix="/api")
    app.include_router(audit.router, prefix="/api")

    @app.get("/healthz", tags=["health"])
    async def healthcheck() -> dict[str, str]:  # pragma: no cover - trivial
        return {"status": "ok"}

    return app


app = create_app()
