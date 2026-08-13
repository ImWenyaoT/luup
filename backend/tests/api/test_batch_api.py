"""`POST /api/batch`：网页发起一次串行批跑。

批次与单题的唯一实质差别是寿命：单题十几分钟，125 题几十小时。因此这里最该被钉住的
不是响应体，而是 argv 与 `start_new_session=True`——前者说明它复用的是既有的 `app.batch`
而不是第二个驱动器，后者说明关掉浏览器、重启 uvicorn 都不会把批次一起带走。
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path
from threading import Event
from time import monotonic

import pytest
from fastapi.testclient import TestClient

from app.batch import parse_ids
from app.main import create_app
from app.services.launch import RunLauncher, compact_ids
from app.services.runs import RunService


class FakeBatch:
    """一个不会自己结束的批次子进程；测试自己决定它什么时候退。"""

    pid = os.getpid()

    def __init__(self) -> None:
        self.release = Event()

    def wait(self, timeout: float | None = None) -> int:
        self.release.wait(timeout=timeout if timeout is not None else 5)
        return 0

    def kill(self) -> None:
        self.release.set()


def client_for(tmp_path: Path, factory) -> tuple[TestClient, RunLauncher]:
    launcher = RunLauncher(tmp_path, process_factory=factory)
    return TestClient(create_app(RunService(tmp_path), launcher)), launcher


def test_batch_spawns_a_detached_app_batch_with_the_compacted_ids(tmp_path: Path) -> None:
    child = FakeBatch()
    captured: dict[str, object] = {}

    def factory(argv, **kwargs):
        captured["argv"] = argv
        captured.update(kwargs)
        return child

    client, _ = client_for(tmp_path, factory)

    response = client.post("/api/batch", json={"ids": [7, 3, 1, 2, 3]})

    assert response.status_code == 202
    # 去重升序后是 1,2,3,7：三连号压成区间，孤立的 7 保持原样。
    assert response.json() == {"ids": [1, 2, 3, 7], "idsSpec": "1-3,7"}
    argv = captured["argv"]
    assert argv[1:5] == ["-m", "app.batch", "--ids", "1-3,7"]
    assert argv[5:] == ["--repo-root", str(tmp_path.parent)]
    assert Path(str(captured["cwd"])) == Path(__file__).resolve().parents[2]
    # 这一行是本端点存在的理由：批次要活过起它的那个 uvicorn。
    assert captured["start_new_session"] is True
    assert captured["stdout"] == subprocess.DEVNULL
    assert captured["stderr"] == subprocess.DEVNULL

    child.release.set()


def test_batch_is_refused_while_a_single_run_holds_the_lock(tmp_path: Path) -> None:
    child = FakeBatch()
    client, _ = client_for(tmp_path, lambda *args, **kwargs: child)

    started = client.post("/api/runs", json={"science125Id": 1})
    assert started.status_code == 202

    refused = client.post("/api/batch", json={"ids": [1, 2]})

    assert refused.status_code == 409
    assert refused.json()["code"] == "run_in_progress"
    assert refused.json()["activeRunId"] == started.json()["runId"]

    child.release.set()


def test_a_live_batch_refuses_both_a_second_batch_and_a_single_run(tmp_path: Path) -> None:
    """批次在两题之间不持锁，`runs/.active.json` 那一瞬是空的；守门不能只看它。"""
    child = FakeBatch()
    client, _ = client_for(tmp_path, lambda *args, **kwargs: child)

    assert client.post("/api/batch", json={"ids": [1, 2]}).status_code == 202
    assert (tmp_path / ".active.json").exists() is False

    second = client.post("/api/batch", json={"ids": [3, 4]})
    single = client.post("/api/runs", json={"science125Id": 5})

    assert second.status_code == 409
    assert second.json()["code"] == "run_in_progress"
    assert single.status_code == 409
    assert single.json()["code"] == "run_in_progress"
    # 单题被挡下时不能留下一个预留好的空 run 目录。
    assert [entry.name for entry in tmp_path.iterdir()] == []


def test_a_finished_batch_stops_blocking_the_next_launch(tmp_path: Path) -> None:
    children = [FakeBatch(), FakeBatch()]
    handed = iter(children)
    client, _ = client_for(tmp_path, lambda *args, **kwargs: next(handed))

    assert client.post("/api/batch", json={"ids": [1, 2]}).status_code == 202
    children[0].release.set()

    # 句柄由回收线程清掉，不是同步的；重试到它清掉为止，而不是断言某个内部字段。
    assert _wait_for(lambda: client.post("/api/batch", json={"ids": [3, 4]}).status_code == 202)

    children[1].release.set()


def test_batch_spawn_failure_returns_500(tmp_path: Path) -> None:
    def fail(*args, **kwargs):
        raise OSError("no executable")

    client, _ = client_for(tmp_path, fail)

    response = client.post("/api/batch", json={"ids": [1, 2]})

    assert response.status_code == 500
    assert response.json()["code"] == "spawn_failed"
    # 批次不预留 run 目录，也不碰锁：失败后 runs/ 必须原样。
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize(
    ("headers", "body", "status", "code"),
    [
        ({"content-type": "text/plain"}, "{}", 415, "bad_content_type"),
        (
            {"content-type": "application/json", "origin": "https://evil.test", "host": "testserver"},
            "{}",
            403,
            "cross_site",
        ),
        ({"content-type": "application/json"}, "{", 400, "bad_json"),
        ({"content-type": "application/json"}, "[]", 400, "bad_body"),
        ({"content-type": "application/json"}, "{}", 400, "bad_ids"),
        ({"content-type": "application/json"}, '{"ids":[]}', 400, "bad_ids"),
        ({"content-type": "application/json"}, '{"ids":"1-125"}', 400, "bad_ids"),
        ({"content-type": "application/json"}, '{"ids":[1,"2"]}', 400, "bad_science125_id"),
        ({"content-type": "application/json"}, '{"ids":[1,true]}', 400, "bad_science125_id"),
        ({"content-type": "application/json"}, '{"ids":[1,1.5]}', 400, "bad_science125_id"),
        ({"content-type": "application/json"}, '{"ids":[0]}', 400, "bad_science125_id"),
        ({"content-type": "application/json"}, '{"ids":[126]}', 400, "bad_science125_id"),
        ({"content-type": "application/json"}, f"{{\"ids\":[{','.join(['1'] * 126)}]}}", 400, "too_many_ids"),
    ],
)
def test_batch_input_contract_rejects_before_spawning(
    tmp_path: Path, headers: dict[str, str], body: str, status: int, code: str
) -> None:
    calls: list[object] = []
    client, _ = client_for(tmp_path, lambda *args, **kwargs: calls.append((args, kwargs)))

    response = client.post("/api/batch", content=body, headers=headers)

    assert response.status_code == status
    assert response.json()["code"] == code
    assert calls == []


def test_body_larger_than_the_cap_is_refused_before_parsing(tmp_path: Path) -> None:
    calls: list[object] = []
    client, _ = client_for(tmp_path, lambda *args, **kwargs: calls.append((args, kwargs)))

    response = client.post(
        "/api/batch",
        content='{"ids":[1],"pad":"' + "x" * 5000 + '"}',
        headers={"content-type": "application/json"},
    )

    assert response.status_code == 413
    assert response.json()["code"] == "body_too_large"
    assert calls == []


@pytest.mark.parametrize(
    "ids",
    [[1], [1, 2], [1, 2, 3], [61, 54, 125], list(range(1, 126)), [1, 2, 3, 5, 6, 8, 9, 10, 11]],
)
def test_compact_ids_round_trips_through_the_cli_parser(ids: list[int]) -> None:
    """压缩写法只有一个用户：`app.batch --ids`。它读不回来就等于没压。"""
    assert parse_ids(compact_ids(ids)) == sorted(set(ids))


def test_compact_ids_keeps_pairs_uncompressed() -> None:
    # `12,13` 与 `12-13` 一样长，压了反而多一次心算；与前端 compactIds 同规则。
    assert compact_ids([12, 13]) == "12,13"
    assert compact_ids([12, 13, 14]) == "12-14"
    assert compact_ids([]) == ""


def _wait_for(predicate) -> bool:
    deadline = monotonic() + 2
    while monotonic() < deadline:
        if predicate():
            return True
        Event().wait(0.01)
    return False
