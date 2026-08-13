from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app
from app.services.runs import RunService

RUN_ID = "20260808-062829"
PAPER = {
    "arxivId": "2401.12345",
    "year": "2024",
    "title": "Paper",
    "oneline": "First sentence.",
    "file": "memory/papers/2401.12345.md",
}


def client_for(tmp_path: Path) -> TestClient:
    return TestClient(create_app(RunService(tmp_path)))


def test_science125_endpoint_returns_the_frozen_bank(tmp_path: Path) -> None:
    response = client_for(tmp_path).get("/api/science125")

    assert response.status_code == 200
    assert response.json()["total"] == 125
    assert "retrievedAt" in response.json()


def test_runs_list_and_detail_match_frontend_camel_case_contract(
    tmp_path: Path, write_run: Callable[..., Path]
) -> None:
    write_run(tmp_path, RUN_ID, question_id=1)
    client = client_for(tmp_path)

    listed = client.get("/api/runs?limit=1")
    detail = client.get(f"/api/runs/{RUN_ID}")

    assert listed.status_code == 200
    assert listed.json()["active"] is None
    assert listed.json()["runs"][0]["science125Id"] == 1
    assert listed.json()["runs"][0]["status"] == "passed"
    assert detail.status_code == 200
    assert detail.json()["questionText"].startswith("来源：")
    assert detail.json()["proposal"]["paperTitle"] == "A valid title"
    assert detail.json()["papers"] == [PAPER]


def test_the_paper_list_reads_both_the_legacy_and_the_author_bearing_index(
    tmp_path: Path, write_run: Callable[..., Path]
) -> None:
    """New runs carry 第一作者 for B4 (the fixture default); committed runs carry four columns."""
    write_run(
        tmp_path,
        "20260810-120000",
        artifacts={
            "memory/index.md": (
                "| arXiv id | 年份 | 标题 | 一句话摘要 |\n"
                "| --- | --- | --- | --- |\n"
                "| 2401.12345 | 2024 | Paper | First sentence. |\n"
            )
        },
    )

    detail = client_for(tmp_path).get("/api/runs/20260810-120000")

    assert detail.json()["papers"] == [PAPER]


def test_status_and_artifact_views_are_read_only_and_whitelisted(
    tmp_path: Path, write_run: Callable[..., Path]
) -> None:
    write_run(tmp_path, RUN_ID)
    client = client_for(tmp_path)

    status = client.get(f"/api/runs/{RUN_ID}?view=status")
    artifact = client.get(f"/api/runs/{RUN_ID}?artifact=proposal.md")
    escaped = client.get(f"/api/runs/{RUN_ID}?artifact=../meta.json")

    assert status.status_code == 200
    assert status.json()["status"] == "passed"
    assert "questionText" not in status.json()
    # 子进程 stdout 进 DEVNULL，console.log 永远不存在：读模型不再假装有它。
    assert "logTail" not in status.json()
    assert artifact.status_code == 200
    assert artifact.headers["content-type"].startswith("text/plain")
    assert artifact.text == "# A proposal\n"
    assert escaped.status_code == 404
    assert escaped.json()["code"] == "artifact_not_found"


def test_a_failed_run_that_saved_no_paper_still_renders_its_detail_view(
    tmp_path: Path, write_run: Callable[..., Path]
) -> None:
    """A run can burn its turn budget before saving a single paper; the detail view must still open."""
    write_run(tmp_path, RUN_ID, passed=False, artifacts={"memory/index.md": None})

    detail = client_for(tmp_path).get(f"/api/runs/{RUN_ID}").json()

    assert detail["status"] == "failed"
    assert detail["papers"] == []
    assert detail["failedText"].startswith("# Luup run failed")
    assert detail["verify"]["pass"] is False
    assert "memory/index.md" not in detail["artifactNames"]


def test_a_half_written_json_artifact_is_skipped_instead_of_crashing_the_view(
    tmp_path: Path, write_run: Callable[..., Path]
) -> None:
    """被杀在半路的 run 会留下截断的 JSON；读模型只能把它当作「没有」，不能 500。"""
    write_run(
        tmp_path,
        RUN_ID,
        artifacts={"proposal.json": '{"paperTitle": "truncated mid-w', "exit.json": "{ also truncated"},
    )

    listed = client_for(tmp_path).get("/api/runs?limit=1")
    detail = client_for(tmp_path).get(f"/api/runs/{RUN_ID}")

    assert listed.status_code == 200
    assert listed.json()["runs"][0]["refs"] is None
    assert listed.json()["runs"][0]["classification"] is None
    assert detail.status_code == 200
    assert detail.json()["proposal"] is None
    # 文件本身照常可取：读模型不解释它，但也不藏起来。
    assert "proposal.json" in detail.json()["artifactNames"]


FAILED_REPORT = "# 验收报告（确定性检查）\n\n结果: 1/1 FAILED\n"
ALL_PASS_REPORT = "# 验收报告（确定性检查）\n\n结果: ALL PASS\n"


def test_status_reads_the_structured_verdict_not_the_rendered_report(
    tmp_path: Path, write_run: Callable[..., Path]
) -> None:
    """`verification.json.ok` 与报告文案矛盾时以 JSON 为准——报告是渲染物，不是状态载体。

    两个方向都要钉：`ok=false` 配 ALL PASS 文案不得判通过，`ok=true` 配 FAILED 文案不得判失败。
    否则报告模板改一个字就能翻转一个 run 的成败，正是评估口径最贵的那类 bug。
    """
    write_run(tmp_path, "20260810-000010", artifacts={"verification.json": json.dumps({"ok": False})})
    write_run(
        tmp_path,
        "20260810-000011",
        artifacts={"verification.json": json.dumps({"ok": True}), "verification-report.md": FAILED_REPORT},
    )

    runs = {run["id"]: run for run in client_for(tmp_path).get("/api/runs").json()["runs"]}

    assert runs["20260810-000010"]["status"] == "failed"
    assert runs["20260810-000011"]["status"] == "passed"


def test_status_falls_back_to_the_report_for_runs_written_before_verification_json(
    tmp_path: Path, write_run: Callable[..., Path]
) -> None:
    """已提交的早期 run（20260810-042825/045543/052412）没有 `verification.json`，仍须判对。"""
    write_run(tmp_path, "20260810-000012", artifacts={"verification.json": None})
    write_run(
        tmp_path,
        "20260810-000013",
        artifacts={"verification.json": None, "verification-report.md": FAILED_REPORT},
    )

    runs = {run["id"]: run for run in client_for(tmp_path).get("/api/runs").json()["runs"]}

    assert runs["20260810-000012"]["status"] == "passed"
    assert runs["20260810-000013"]["status"] == "failed"


def test_status_without_either_verdict_artifact_degrades_to_failed(
    tmp_path: Path, write_run: Callable[..., Path]
) -> None:
    """渲染了 proposal 却两种判定都没落盘的 run 只能算没通过：缺席不是通过。"""
    write_run(
        tmp_path,
        "20260810-000014",
        artifacts={"verification.json": None, "verification-report.md": None},
    )
    # 结构化事实存在但不是布尔 `ok`（半截 JSON、字段改名）时退回文案，而不是当作失败。
    write_run(
        tmp_path,
        "20260810-000015",
        artifacts={"verification.json": json.dumps({"ok": "yes"}), "verification-report.md": ALL_PASS_REPORT},
    )

    runs = {run["id"]: run for run in client_for(tmp_path).get("/api/runs").json()["runs"]}

    assert runs["20260810-000014"]["status"] == "failed"
    assert runs["20260810-000015"]["status"] == "passed"


def test_the_list_projection_carries_the_batch_cohort_facts(tmp_path: Path, write_run: Callable[..., Path]) -> None:
    """批次概览按 (questionId, classification, gitCommit) 读列表，所以这三样必须在列表里。

    它们全部来自 `exit.json`——这个投影不新增状态，只是把已经落盘的终态事实换个视角发出去。
    """
    write_run(
        tmp_path,
        "20260810-000002",
        question_id=61,
        passed=False,
        artifacts={
            "exit.json": json.dumps(
                {
                    "exitCode": 1,
                    "classification": "infra_timeout",
                    "sourceIdentity": {"gitCommit": "abc1234", "treeDirty": True},
                }
            )
        },
    )

    listed = client_for(tmp_path).get("/api/runs").json()["runs"][0]

    assert listed["science125Id"] == 61
    assert listed["status"] == "failed"
    assert listed["classification"] == "infra_timeout"
    assert listed["sourceIdentity"] == {"gitCommit": "abc1234", "treeDirty": True}


def test_the_list_projection_reports_missing_cohort_facts_as_null(
    tmp_path: Path, write_run: Callable[..., Path]
) -> None:
    """已提交的旧 run 要么没有 `exit.json`，要么写的是 `sourceIdentity: null`——两者都不能编。"""
    write_run(tmp_path, "20260810-000003", artifacts={"exit.json": None})
    write_run(tmp_path, "20260810-000004")  # fixture 默认就是 `sourceIdentity: null`
    write_run(
        tmp_path,
        "20260810-000005",
        artifacts={"exit.json": json.dumps({"exitCode": 0, "sourceIdentity": {"treeDirty": False}})},
    )

    runs = {run["id"]: run for run in client_for(tmp_path).get("/api/runs").json()["runs"]}

    assert [runs[key]["classification"] for key in sorted(runs)] == [None, None, None]
    # 没有 commit 的身份对象无法定位代码，等于没有身份；不能只凭 treeDirty 就发一个空 commit。
    assert [runs[key]["sourceIdentity"] for key in sorted(runs)] == [None, None, None]


def test_read_api_preserves_legacy_error_codes(tmp_path: Path) -> None:
    client = client_for(tmp_path)

    assert client.get("/api/runs?limit=0").json()["code"] == "bad_limit"
    assert client.get("/api/runs/not-an-id").json()["code"] == "bad_run_id"
    missing = client.get(f"/api/runs/{RUN_ID}?view=status")
    assert missing.status_code == 404
    assert missing.json()["code"] == "run_not_found"
