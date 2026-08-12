from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from threading import Event
from time import monotonic

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.services.launch import RUN_TIMEOUT_SECONDS, FileRunLock, RunInProgress, RunLauncher
from app.services.runs import RunService


class FakeChild:
    pid = os.getpid()

    def __init__(self, exit_code: int = 0, *, hangs: bool = False) -> None:
        self.exit_code = exit_code
        self.hangs = hangs
        self.killed = False
        self.release = Event()

    def wait(self, timeout: float | None = None) -> int:
        if self.hangs and not self.killed:
            raise subprocess.TimeoutExpired(cmd="app.cli", timeout=timeout or 0)
        self.release.wait(timeout=2)
        return self.exit_code

    def kill(self) -> None:
        self.killed = True
        self.release.set()


def client_for(tmp_path: Path, factory, **launcher_kwargs) -> tuple[TestClient, RunLauncher]:
    service = RunService(tmp_path)
    launcher = RunLauncher(tmp_path, process_factory=factory, **launcher_kwargs)
    return TestClient(create_app(service, launcher)), launcher


def test_post_reserves_run_and_returns_before_the_child_finishes(tmp_path: Path) -> None:
    child = FakeChild()
    client, _ = client_for(tmp_path, lambda *args, **kwargs: child)

    response = client.post("/api/runs", json={"science125Id": 1})

    assert response.status_code == 202
    payload = response.json()
    assert payload["status"] == "working"
    assert payload["pollUrl"] == f"/api/runs/{payload['runId']}?view=status"
    run_dir = Path(payload["runDir"])
    assert run_dir.name == payload["runId"]
    assert "第 1 题" in (run_dir / "question.md").read_text(encoding="utf-8")
    assert json.loads((run_dir / "meta.json").read_text(encoding="utf-8"))["questionId"] == 1
    assert client.get(f"/api/runs/{payload['runId']}?view=status").json()["status"] == "working"
    assert client.get("/api/runs").json()["active"] == payload["runId"]
    assert client.post("/api/runs", json={"question": "a question with whitespace"}).status_code == 409

    child.release.set()
    assert _wait_for(lambda: (run_dir / "exit.json").exists())
    assert _wait_for(lambda: not (tmp_path / ".active.json").exists())


def test_child_failure_leaves_exit_meta_and_failed_evidence(tmp_path: Path) -> None:
    child = FakeChild(exit_code=3)
    client, _ = client_for(tmp_path, lambda *args, **kwargs: child)

    response = client.post("/api/runs", json={"question": "a valid free form scientific question"})
    run_dir = Path(response.json()["runDir"])
    child.release.set()

    # FAILED.md is the last file `_complete` writes, so waiting on it settles the whole trio.
    assert _wait_for(lambda: (run_dir / "FAILED.md").exists())
    assert json.loads((run_dir / "exit.json").read_text(encoding="utf-8"))["exitCode"] == 3
    meta = json.loads((run_dir / "meta.json").read_text(encoding="utf-8"))
    assert meta["exitCode"] == 3
    assert "finishedAt" in meta


def test_a_hung_child_is_killed_at_the_timeout_and_the_lock_is_released(tmp_path: Path) -> None:
    """A network hang used to hold the serialization lock forever; the parent now settles the run."""
    child = FakeChild(hangs=True)
    client, _ = client_for(tmp_path, lambda *args, **kwargs: child, timeout_seconds=0.01)

    response = client.post("/api/runs", json={"science125Id": 1})
    run_dir = Path(response.json()["runDir"])

    assert _wait_for(lambda: (run_dir / "FAILED.md").exists())
    assert child.killed is True
    exit_fact = json.loads((run_dir / "exit.json").read_text(encoding="utf-8"))
    assert exit_fact["exitCode"] == -1
    assert exit_fact["classification"] == "infra_timeout"
    failed = (run_dir / "FAILED.md").read_text(encoding="utf-8")
    assert "infra_timeout" in failed
    assert _wait_for(lambda: not (tmp_path / ".active.json").exists())
    assert client.post("/api/runs", json={"science125Id": 2}).status_code != 409


def test_the_default_child_timeout_is_forty_minutes(tmp_path: Path) -> None:
    """The timeout is a configurable constant, not a literal buried in the wait loop."""
    assert RUN_TIMEOUT_SECONDS == 40 * 60
    assert RunLauncher(tmp_path).timeout_seconds == RUN_TIMEOUT_SECONDS


def test_a_child_written_classification_survives_the_parent_settling_the_run(tmp_path: Path) -> None:
    """`app.cli` owns the pipeline failure class; the launcher must not overwrite it with its own."""
    child = FakeChild(exit_code=1)
    client, _ = client_for(tmp_path, lambda *args, **kwargs: child)

    response = client.post("/api/runs", json={"science125Id": 1})
    run_dir = Path(response.json()["runDir"])
    (run_dir / "exit.json").write_text(
        json.dumps({"exitCode": 1, "endedAt": "2026-08-10T00:00:00.000Z", "classification": "verifier_refs"}),
        encoding="utf-8",
    )
    child.release.set()

    assert _wait_for(lambda: json.loads((run_dir / "exit.json").read_text(encoding="utf-8")).get("endedAt") is not None)
    assert _wait_for(lambda: not (tmp_path / ".active.json").exists())
    assert json.loads((run_dir / "exit.json").read_text(encoding="utf-8"))["classification"] == "verifier_refs"


def test_a_child_written_source_identity_survives_the_parent_settling_the_run(tmp_path: Path) -> None:
    """`app.cli` records which build produced the run; the parent settles it and must merge.

    The parent used to rebuild exit.json from scratch after `wait()` and carry only
    `classification` across, so every run started over HTTP silently lost
    `sourceIdentity` — the field the 125 statistics cohort by.
    """
    child = FakeChild(exit_code=0)
    client, _ = client_for(tmp_path, lambda *args, **kwargs: child)

    response = client.post("/api/runs", json={"science125Id": 1})
    run_dir = Path(response.json()["runDir"])
    (run_dir / "exit.json").write_text(
        json.dumps(
            {
                "exitCode": 0,
                "endedAt": "2026-08-10T00:00:00.000Z",
                "sourceIdentity": {"gitCommit": "abc123", "treeDirty": False},
            }
        ),
        encoding="utf-8",
    )
    child.release.set()

    assert _wait_for(lambda: not (tmp_path / ".active.json").exists())
    exit_fact = json.loads((run_dir / "exit.json").read_text(encoding="utf-8"))
    assert exit_fact["sourceIdentity"] == {"gitCommit": "abc123", "treeDirty": False}
    assert exit_fact["exitCode"] == 0
    assert exit_fact["endedAt"] != "2026-08-10T00:00:00.000Z"  # The parent still owns the settle time.


def test_spawn_failure_releases_lock_and_returns_500(tmp_path: Path) -> None:
    def fail(*args, **kwargs):
        raise OSError("no executable")

    client, _ = client_for(tmp_path, fail)

    response = client.post("/api/runs", json={"science125Id": 1})

    assert response.status_code == 500
    assert response.json()["code"] == "spawn_failed"
    assert not (tmp_path / ".active.json").exists()
    failed = next(path for path in tmp_path.iterdir() if path.is_dir())
    assert (failed / "FAILED.md").exists()


def test_launcher_uses_backend_as_child_working_directory(tmp_path: Path) -> None:
    child = FakeChild()
    captured: dict[str, object] = {}

    def factory(*args, **kwargs):
        captured.update(kwargs)
        return child

    client, _ = client_for(tmp_path, factory)
    response = client.post("/api/runs", json={"science125Id": 1})

    assert response.status_code == 202
    assert Path(str(captured["cwd"])) == Path(__file__).resolve().parents[2]
    child.release.set()


def test_launcher_skips_an_existing_same_second_run_id(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    child = FakeChild()
    identifiers = iter(["20260810-120000", "20260810-120001"])
    monkeypatch.setattr("app.services.launch.utc_stamp", lambda point=None: next(identifiers))
    (tmp_path / "20260810-120000").mkdir()
    client, _ = client_for(tmp_path, lambda *args, **kwargs: child)

    response = client.post("/api/runs", json={"science125Id": 1})

    assert response.status_code == 202
    assert response.json()["runId"] != "20260810-120000"
    child.release.set()


def test_stale_lock_is_not_reported_as_active(tmp_path: Path) -> None:
    (tmp_path / ".active.json").write_text(
        json.dumps({"runId": "20260810-120000", "pid": 99999999, "startedAt": "2026-08-10T12:00:00Z", "token": "stale"}),
        encoding="utf-8",
    )

    assert FileRunLock(tmp_path).active_run_id() is None


def test_partially_published_lock_is_never_deleted_as_stale(tmp_path: Path) -> None:
    lock_path = tmp_path / ".active.json"
    lock_path.write_text("", encoding="utf-8")

    with pytest.raises(RunInProgress):
        FileRunLock(tmp_path).acquire()

    assert lock_path.exists()


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
        ({"content-type": "application/json"}, '{"question":"both choices work", "science125Id":1}', 400, "bad_input"),
        ({"content-type": "application/json"}, '{"science125Id":126}', 400, "bad_science125_id"),
        ({"content-type": "application/json"}, '{"question":"single-token"}', 400, "bad_question_shape"),
        ({"content-type": "application/json"}, '{"question":"short"}', 400, "bad_question_length"),
    ],
)
def test_post_input_contract_rejects_before_spawning(
    tmp_path: Path, headers: dict[str, str], body: str, status: int, code: str
) -> None:
    calls: list[object] = []
    client, _ = client_for(tmp_path, lambda *args, **kwargs: calls.append((args, kwargs)))

    response = client.post("/api/runs", content=body, headers=headers)

    assert response.status_code == status
    assert response.json()["code"] == code
    assert calls == []


def _wait_for(predicate) -> bool:
    deadline = monotonic() + 1
    while monotonic() < deadline:
        if predicate():
            return True
        Event().wait(0.01)
    return False
