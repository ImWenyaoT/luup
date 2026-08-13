"""Science-125 and run HTTP routes."""

from __future__ import annotations

import json
import re

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, PlainTextResponse, Response

from app.domain.runs import is_run_id
from app.domain.science125 import find_question, read_science125
from app.services.launch import RunInProgress, RunLauncher, SpawnFailure, freeform_text, science125_text
from app.services.runs import RunService

router = APIRouter()

MAX_BODY_BYTES = 4 * 1024

BATCH_LIMIT = 125
"""题库有多大，一次批次就最多多大——再多只可能是重复或越界的题号。"""


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": message, "code": code})


def _in_progress(exc: RunInProgress) -> JSONResponse:
    """单题与批次共用同一个拒绝形状，前端才能只写一套「已有东西在跑」的处理。"""
    return JSONResponse(
        status_code=409,
        content={
            "error": "已有运行中的 run，pipeline 串行执行",
            "code": "run_in_progress",
            "activeRunId": exc.holder.run_id,
        },
    )


def _limit(raw: str | None) -> int | None:
    if raw is None:
        return 50
    match = re.match(r"^[\t\n\v\f\r ]*([+-]?[0-9]+)", raw)
    if match is None:
        return None
    value = int(match.group(1))
    return value if 1 <= value <= 500 else None


def _same_origin(request: Request) -> JSONResponse | None:
    content_type = request.headers.get("content-type", "").lower().split(";", 1)[0].strip()
    if not content_type.startswith("application/json"):
        return _error(415, "bad_content_type", "content-type 必须是 application/json")
    origin = request.headers.get("origin")
    if origin is None:
        return None
    match = re.fullmatch(r"https?://([^/]+)", origin)
    if match is None:
        return _error(403, "cross_site", "Origin 不可解析")
    return None if match.group(1) == request.headers.get("host") else _error(403, "cross_site", "跨站请求被拒绝")


@router.get("/science125")
def science125() -> JSONResponse:
    bank = read_science125()
    if bank is None:
        return _error(500, "fixture_unreadable", "science125 题库解析失败")
    return JSONResponse(content=bank.model_dump(by_alias=True))


@router.get("/runs", operation_id="runs_api_runs_get", summary="Runs")
def list_runs(request: Request, limit: str | None = None) -> JSONResponse:
    parsed = _limit(limit)
    if parsed is None:
        return _error(400, "bad_limit", "limit 必须是 1..500 的整数")
    run_service: RunService = request.app.state.run_service
    launcher: RunLauncher = request.app.state.run_launcher
    return JSONResponse(content={"active": launcher.active_run_id, "runs": run_service.list_runs(parsed)})


async def _json_object(request: Request) -> dict[str, object] | JSONResponse:
    """同源守卫 + 体积上限 + JSON 对象——两个 POST 入口的共同前置，逐条错误码不变。"""
    blocked = _same_origin(request)
    if blocked is not None:
        return blocked
    raw = await request.body()
    if len(raw) > MAX_BODY_BYTES:
        return _error(413, "body_too_large", "请求体超过 4096 字节")
    try:
        body = json.loads(raw or b"null")
    except json.JSONDecodeError:
        return _error(400, "bad_json", "请求体不是合法 JSON")
    if not isinstance(body, dict):
        return _error(400, "bad_body", "请求体必须是 JSON 对象")
    return body


@router.post("/runs")
async def start_run(request: Request) -> JSONResponse:
    body = await _json_object(request)
    if isinstance(body, JSONResponse):
        return body
    question = body.get("question")
    science125_id = body.get("science125Id")
    has_question = question is not None and question != ""
    has_science125_id = science125_id is not None
    if has_question == has_science125_id:
        return _error(400, "bad_input", "question 与 science125Id 必须给且只给一个")
    if has_science125_id:
        if isinstance(science125_id, bool) or not isinstance(science125_id, int) or not 1 <= science125_id <= 125:
            return _error(400, "bad_science125_id", "science125Id 必须是 1..125 的整数")
        selected = find_question(science125_id)
        if selected is None:
            return _error(404, "question_not_found", f"Science-125 题库里没有第 {science125_id} 题")
        text = science125_text(selected)
        question_id: int | None = science125_id
    else:
        if not isinstance(question, str):
            return _error(400, "bad_question", "question 必须是字符串")
        trimmed = question.strip()
        if not 8 <= len(trimmed) <= 2000:
            return _error(400, "bad_question_length", "question 长度必须在 8..2000 之间")
        if re.fullmatch(r"\S+", trimmed):
            return _error(400, "bad_question_shape", "question 不能是单个无空白 token（会被当成文件路径）")
        text = freeform_text(trimmed)
        question_id = None
    launcher: RunLauncher = request.app.state.run_launcher
    try:
        started = launcher.start(text, question_id)
    except RunInProgress as exc:
        return _in_progress(exc)
    except SpawnFailure as exc:
        return _error(500, "spawn_failed", str(exc))
    return JSONResponse(
        status_code=202,
        content={
            "runId": started.run_id,
            "runDir": str(started.run_dir),
            "status": "working",
            "pollUrl": f"/api/runs/{started.run_id}?view=status",
        },
    )


@router.post("/batch")
async def start_batch(request: Request) -> JSONResponse:
    """发起一次串行批跑。

    单写者锁保证同时最多一个可变 run，所以「跑多题」只能是一个串行任务，不是并发。
    这里把网页上的多选交给既有的 `app.batch`（断点续跑、熔断、分类 tally 都在那边），
    自己不记任何批次状态：进度由 `/batch` 页从 runs/ 派生。
    """
    body = await _json_object(request)
    if isinstance(body, JSONResponse):
        return body
    ids = body.get("ids")
    if not isinstance(ids, list) or not ids:
        return _error(400, "bad_ids", "ids 必须是非空的题号数组")
    if len(ids) > BATCH_LIMIT:
        return _error(400, "too_many_ids", f"ids 一次最多 {BATCH_LIMIT} 项")
    for item in ids:
        if isinstance(item, bool) or not isinstance(item, int) or not 1 <= item <= BATCH_LIMIT:
            return _error(400, "bad_science125_id", f"ids 的每一项必须是 1..{BATCH_LIMIT} 的整数")
    bank = read_science125()
    if bank is None:
        return _error(500, "fixture_unreadable", "science125 题库解析失败")
    known = {question.id for domain in bank.domains for question in domain.questions}
    unknown = sorted({item for item in ids if item not in known})
    if unknown:
        return _error(404, "question_not_found", f"Science-125 题库里没有第 {unknown[0]} 题")
    launcher: RunLauncher = request.app.state.run_launcher
    try:
        started = launcher.start_batch(sorted(set(ids)))
    except RunInProgress as exc:
        return _in_progress(exc)
    except SpawnFailure as exc:
        return _error(500, "spawn_failed", str(exc))
    return JSONResponse(status_code=202, content={"ids": list(started.ids), "idsSpec": started.spec})


@router.get("/runs/{identifier}", operation_id="run_api_runs__identifier__get", summary="Run")
def get_run(identifier: str, request: Request, view: str | None = None, artifact: str | None = None) -> Response:
    if not is_run_id(identifier):
        return _error(400, "bad_run_id", "runId 必须形如 20260808-062829")
    run_service: RunService = request.app.state.run_service
    if artifact is not None:
        body = run_service.artifact(identifier, artifact)
        if body is None:
            return _error(404, "artifact_not_found", f"工件不存在或不可读：{artifact}")
        return PlainTextResponse(body)
    if view == "status":
        status = run_service.status(identifier)
        if status is None:
            return _error(404, "run_not_found", f"run 目录不存在：{identifier}")
        return JSONResponse(content=status)
    detail = run_service.detail(identifier)
    if detail is None:
        return _error(404, "run_not_found", f"run 目录不存在：{identifier}")
    return JSONResponse(content=detail)
