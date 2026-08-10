from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app
from app.services.runs import RunService


def write_run(root: Path, identifier: str = "20260808-062829") -> Path:
    run = root / identifier
    run.mkdir(parents=True)
    (run / "question.md").write_text(
        "来源：《Science》125 前沿科学问题（Science-125 题库）第 1 题，Mathematical Sciences。\n\n问题：What makes prime numbers so special?\n",
        encoding="utf-8",
    )
    (run / "proposal.md").write_text("# A proposal\n", encoding="utf-8")
    (run / "proposal.json").write_text(
        json.dumps({"paperTitle": "A valid title", "references": [{"arxivId": "2401.12345"}]}),
        encoding="utf-8",
    )
    (run / "evidence.md").write_text("evidence", encoding="utf-8")
    (run / "verification-report.md").write_text(
        "# 验收报告\n\n结果: ALL PASS\n\n| 检查项 | 结果 | 说明 |\n| --- | --- | --- |\n| B3.count | ✅ | references = 5 |\n",
        encoding="utf-8",
    )
    (run / "meta.json").write_text(
        json.dumps(
            {
                "questionId": 1,
                "startedAt": "2026-08-08T06:28:29.000Z",
                "finishedAt": "2026-08-08T06:30:00.000Z",
                "exitCode": 0,
            }
        ),
        encoding="utf-8",
    )
    papers = run / "memory" / "papers"
    papers.mkdir(parents=True)
    (run / "memory" / "index.md").write_text(
        "| arXiv id | 年份 | 标题 | 一句话摘要 |\n| --- | --- | --- | --- |\n| 2401.12345 | 2024 | Paper | First sentence. |\n",
        encoding="utf-8",
    )
    return run


def client_for(tmp_path: Path) -> TestClient:
    return TestClient(create_app(RunService(tmp_path)))


def test_science125_endpoint_returns_the_frozen_bank(tmp_path: Path) -> None:
    response = client_for(tmp_path).get("/api/science125")

    assert response.status_code == 200
    assert response.json()["total"] == 125
    assert "retrievedAt" in response.json()


def test_runs_list_and_detail_match_frontend_camel_case_contract(tmp_path: Path) -> None:
    run = write_run(tmp_path)
    (run / "proposal.json.rejected.json").write_text('{"paperTitle":"obsolete draft"}', encoding="utf-8")
    client = client_for(tmp_path)

    listed = client.get("/api/runs?limit=1")
    detail = client.get("/api/runs/20260808-062829")

    assert listed.status_code == 200
    assert listed.json()["active"] is None
    assert listed.json()["runs"][0]["science125Id"] == 1
    assert listed.json()["runs"][0]["status"] == "passed"
    assert detail.status_code == 200
    assert detail.json()["questionText"].startswith("来源：")
    assert detail.json()["proposal"]["paperTitle"] == "A valid title"
    assert detail.json()["proposalRejected"] is None
    assert detail.json()["papers"] == [
        {
            "arxivId": "2401.12345",
            "year": "2024",
            "title": "Paper",
            "oneline": "First sentence.",
            "file": "memory/papers/2401.12345.md",
        }
    ]


def test_the_paper_list_reads_both_the_legacy_and_the_author_bearing_index(tmp_path: Path) -> None:
    """Committed runs carry a four-column index; new runs add 第一作者 for B4."""
    run = write_run(tmp_path, "20260810-120000")
    (run / "memory" / "index.md").write_text(
        "| arXiv id | 年份 | 第一作者 | 标题 | 一句话摘要 |\n"
        "| --- | --- | --- | --- | --- |\n"
        "| 2401.12345 | 2024 | Ada Lovelace | Paper | First sentence. |\n",
        encoding="utf-8",
    )

    detail = client_for(tmp_path).get("/api/runs/20260810-120000")

    assert detail.json()["papers"] == [
        {
            "arxivId": "2401.12345",
            "year": "2024",
            "title": "Paper",
            "oneline": "First sentence.",
            "file": "memory/papers/2401.12345.md",
        }
    ]


def test_status_and_artifact_views_are_read_only_and_whitelisted(tmp_path: Path) -> None:
    write_run(tmp_path)
    client = client_for(tmp_path)

    status = client.get("/api/runs/20260808-062829?view=status")
    artifact = client.get("/api/runs/20260808-062829?artifact=proposal.md")
    escaped = client.get("/api/runs/20260808-062829?artifact=../meta.json")

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


def test_read_api_preserves_legacy_error_codes(tmp_path: Path) -> None:
    client = client_for(tmp_path)

    assert client.get("/api/runs?limit=0").json()["code"] == "bad_limit"
    assert client.get("/api/runs/not-an-id").json()["code"] == "bad_run_id"
    missing = client.get("/api/runs/20260808-062829?view=status")
    assert missing.status_code == 404
    assert missing.json()["code"] == "run_not_found"
