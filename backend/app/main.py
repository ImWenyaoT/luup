"""Luup FastAPI application entrypoint."""

from __future__ import annotations

from fastapi import FastAPI

from app.api.main import api_router
from app.services.launch import RunLauncher
from app.services.runs import RunService


def create_app(service: RunService | None = None, launcher: RunLauncher | None = None) -> FastAPI:
    """Create the app and wire its local run adapters."""

    app = FastAPI(title="Luup API")
    app.state.run_service = service or RunService()
    app.state.run_launcher = launcher or RunLauncher(app.state.run_service.runs_root)
    app.include_router(api_router, prefix="/api")
    return app


app = create_app()
