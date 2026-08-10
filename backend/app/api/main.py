"""Top-level API router."""

from fastapi import APIRouter

from app.api.routes import runs

api_router = APIRouter()
api_router.include_router(runs.router)
