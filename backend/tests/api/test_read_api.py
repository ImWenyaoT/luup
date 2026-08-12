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
    write_run(
        tmp_path,
        RUN_ID,
        question_id=1,
        artifacts={"proposal.json.rejected.json": '{"paperTitle":"obsolete draft"}'},
    )
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
    assert detail.json()["proposalRejected"] is None
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


def test_read_api_preserves_legacy_error_codes(tmp_path: Path) -> None:
    client = client_for(tmp_path)

    assert client.get("/api/runs?limit=0").json()["code"] == "bad_limit"
    assert client.get("/api/runs/not-an-id").json()["code"] == "bad_run_id"
    missing = client.get(f"/api/runs/{RUN_ID}?view=status")
    assert missing.status_code == 404
    assert missing.json()["code"] == "run_not_found"


# --- 退役中的 TS 时代形状 -------------------------------------------------------------------
# 下面这一段描述的是 2026-08-08 之前那批已提交 run 的目录形状：五个节点各写一份
# `verdicts/<node>-r<round>.json`，产物叫 `hypotheses.md` / `critique.md`，且没有
# `review.json`（读模型正是靠它区分新旧拓扑）。今天的 Harness 一个字节都不再写成这样，
# 但 `runs/` 里躺着 8 个这种 run，读模型仍得读它们。
#
# 这些测试断言的是**当下的**行为，作用是给「删掉 legacy 读取路径」当删除前的安全网：
# 那一步落地时，`_LEGACY_NODES`、`_VERDICT_FILE`、`RunService._verdicts` 和这一整段一起删。
# 形状写死在这里而不是进共享 fixture，就是为了让删除点只有一处。

LEGACY_VERDICT = json.dumps(
    {
        "node": "literature",
        "verdict": "pass",
        "round": 1,
        "checks": [{"criterion": "≥8 fact cards", "pass": True, "reason": "12 cards returned"}],
    }
)
LEGACY_REJECT = json.dumps(
    {
        "verdict": "reject",
        "rework": "补一个反例检索",
        "checks": [
            {"criterion": "2-3 candidates", "result": "fail", "detail": "只有 1 条"},
            {"pass": None, "note": "既没有 criterion 也没有理由"},
            "这一项根本不是对象",
        ],
    }
)


def legacy_run(root: Path, run_id: str, *, extra: dict[str, str] | None = None) -> Path:
    files = {
        "question.md": "来源：《Science》125 前沿科学问题（Science-125 题库）第 61 题，天文。\n\n问题：Q\n",
        "meta.json": json.dumps({"questionId": 61, "startedAt": "2026-08-08T06:28:29.000Z"}),
        "evidence.md": "evidence\n",
        "hypotheses.md": "# 假设\n",
        "critique.md": "# 批判\n",
        "proposal.json": json.dumps({"paperTitle": "A legacy title", "references": [{"arxivId": "2401.12345"}]}),
        "proposal.md": "# A proposal\n",
        "verification-report.md": "# 验收报告\n\n结果: ALL PASS\n",
        **(extra or {}),
    }
    run = root / run_id
    run.mkdir(parents=True)
    for name, text in files.items():
        target = run / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")
    return run


def test_a_legacy_run_without_review_json_keeps_the_five_retired_node_names(tmp_path: Path) -> None:
    """No review.json and no trace.jsonl means the read model falls back to the TS-era node set."""
    legacy_run(tmp_path, "20260808-055459")
    client = client_for(tmp_path)

    listed = client.get("/api/runs?limit=1").json()["runs"][0]
    status = client.get("/api/runs/20260808-055459?view=status").json()

    # The list view of a legacy run is a key->state map, not the node list a pro run returns.
    assert listed["nodes"] == {"literature": "done", "hypothesis": "done", "critique": "done", "proposal": "done"}
    assert [node["key"] for node in status["nodes"]] == [
        "literature",
        "hypothesis",
        "critique",
        "proposal",
        "verify",
    ]
    assert [node["artifact"] for node in status["nodes"]] == [
        "evidence.md",
        "hypotheses.md",
        "critique.md",  # critique.json was the primary name; critique.md is the accepted alias.
        "proposal.json",
        "verification-report.md",
    ]
    assert all(node["state"] == "done" for node in status["nodes"])


def test_the_status_view_reports_every_retired_verdict_file_and_counts_the_rejects(tmp_path: Path) -> None:
    """`verdicts/<node>-r<n>.json` is read from disk by round; a `.rejected.json` sibling is a second reject."""
    legacy_run(
        tmp_path,
        "20260808-062829",
        extra={
            "verdicts/literature-r1.json": LEGACY_VERDICT,
            "verdicts/hypothesis-r2.json": LEGACY_REJECT,
            "verdicts/hypothesis-r2.json.rejected.json": '{"verdict":"garbage"}',
            "verdicts/proposal-r1.json": "{ truncated",  # Unreadable JSON is skipped, never fatal.
            "verdicts/not-a-verdict.json": LEGACY_VERDICT,  # Wrong name shape: not a verdict at all.
        },
    )

    status = client_for(tmp_path).get("/api/runs/20260808-062829?view=status").json()

    assert status["verdicts"] == [
        {
            "file": "hypothesis-r2.json",
            "node": "hypothesis",  # Taken from the file name: this payload carries no "node".
            "round": 2,
            "verdict": "reject",
            "checks": [
                {"criterion": "2-3 candidates", "pass": False, "reason": "只有 1 条"},
                {"criterion": "(未命名判据)", "pass": None, "reason": ""},
            ],
            "rework": "补一个反例检索",
            "rejectedRaw": '{"verdict":"garbage"}',
        },
        {
            "file": "literature-r1.json",
            "node": "literature",
            "round": 1,
            "verdict": "pass",
            "checks": [{"criterion": "≥8 fact cards", "pass": True, "reason": "12 cards returned"}],
            "rework": None,
            "rejectedRaw": None,
        },
    ]
    rejects = {node["key"]: node["rejects"] for node in status["nodes"]}
    assert rejects == {"literature": 0, "hypothesis": 2, "critique": 0, "proposal": 0, "verify": 0}
