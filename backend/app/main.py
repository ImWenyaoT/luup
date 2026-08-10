"""Luup FastAPI application entrypoint."""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI

from app.api.main import api_router
from app.services.launch import RunLauncher
from app.services.runs import RunService

FRONTEND_DIR = Path(__file__).parent / "frontend"


def create_app(service: RunService | None = None, launcher: RunLauncher | None = None) -> FastAPI:
    """Create the app and wire its local run adapters."""

    app = FastAPI(title="Luup API")
    app.state.run_service = service or RunService()
    app.state.run_launcher = launcher or RunLauncher(app.state.run_service.runs_root)
    app.include_router(api_router, prefix="/api")
    # 前端构建产物由 vite 写进 app/frontend（不入库）。开发态和测试没有这个目录，
    # 此时不挂载：进程照常起、/ 直接 404，而不是每个请求都炸 StaticFiles。
    # 代价是先起服务再构建前端需要重启一次。
    if FRONTEND_DIR.is_dir():
        app.frontend("/", directory=FRONTEND_DIR)
    return app


app = create_app()
