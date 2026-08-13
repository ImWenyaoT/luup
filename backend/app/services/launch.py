"""HTTP 启动器：预留 run、跨进程锁和独立 CLI 子进程的唯一边界。"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import uuid
from collections.abc import Callable, Sequence
from contextlib import suppress
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Thread
from typing import Protocol

from app.domain.runs import render_failed, replace_text, utc_stamp
from app.domain.science125 import Science125Question


class ChildProcess(Protocol):
    pid: int

    def wait(self, timeout: float | None = None) -> int: ...

    def kill(self) -> None: ...


ProcessFactory = Callable[..., ChildProcess]

RUN_TIMEOUT_SECONDS = 40 * 60
"""A pipeline that has not settled in 40 minutes is hung, not slow.

One arXiv socket that never closes used to hold `runs/.active.json` forever, which
blocks every later run. The parent kills the child and settles the run itself.
"""

KILL_GRACE_SECONDS = 10.0


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _read_mapping(path: Path) -> dict[str, object]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return {}
    return raw if isinstance(raw, dict) else {}


@dataclass(frozen=True)
class LockHolder:
    run_id: str | None
    pid: int
    started_at: str


class RunInProgress(RuntimeError):
    def __init__(self, holder: LockHolder) -> None:
        super().__init__("已有运行中的 run，pipeline 串行执行")
        self.holder = holder


class SpawnFailure(RuntimeError):
    pass


class HeldRunLock:
    def __init__(self, path: Path, token: str, holder: LockHolder) -> None:
        self._path = path
        self._token = token
        self._holder = holder

    def set_run_id(self, run_id: str) -> None:
        self._update(run_id=run_id)

    def set_pid(self, pid: int) -> None:
        self._update(pid=pid)

    def _update(self, *, run_id: str | None = None, pid: int | None = None) -> None:
        current = FileRunLock.read_raw(self._path)
        if current is None or current.get("token") != self._token:
            return
        next_holder = LockHolder(
            run_id=run_id if run_id is not None else self._holder.run_id,
            pid=pid if pid is not None else self._holder.pid,
            started_at=self._holder.started_at,
        )
        FileRunLock.write_raw(self._path, next_holder, self._token)
        self._holder = next_holder

    def release(self) -> bool:
        current = FileRunLock.read_raw(self._path)
        if current is None or current.get("token") != self._token:
            return False
        try:
            self._path.unlink()
        except FileNotFoundError:
            return False
        return True


class FileRunLock:
    """`runs/.active.json` 以 O_EXCL 抢占，因而不同 Uvicorn 进程共用一把锁。"""

    def __init__(self, runs_root: Path) -> None:
        self.path = runs_root / ".active.json"

    @staticmethod
    def read_raw(path: Path) -> dict[str, object] | None:
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            return None
        return raw if isinstance(raw, dict) else None

    @staticmethod
    def write_raw(path: Path, holder: LockHolder, token: str) -> None:
        replace_text(
            path,
            json.dumps(
                {"runId": holder.run_id, "pid": holder.pid, "startedAt": holder.started_at, "token": token},
                ensure_ascii=False,
            )
            + "\n",
        )

    @staticmethod
    def holder(raw: dict[str, object] | None) -> LockHolder:
        if raw is None:
            return LockHolder(run_id=None, pid=-1, started_at="1970-01-01T00:00:00.000Z")
        raw_run_id = raw.get("runId")
        raw_pid = raw.get("pid")
        raw_started_at = raw.get("startedAt")
        return LockHolder(
            run_id=raw_run_id if isinstance(raw_run_id, str) else None,
            pid=raw_pid if isinstance(raw_pid, int) and not isinstance(raw_pid, bool) else -1,
            started_at=raw_started_at if isinstance(raw_started_at, str) else "1970-01-01T00:00:00.000Z",
        )

    @staticmethod
    def _alive(pid: int) -> bool:
        if pid <= 0:
            return False
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return False
        except PermissionError:
            return True
        return True

    def live_holder(self) -> LockHolder | None:
        """持锁者，仅当它的进程还活着。刚抢到锁、还没写 runId 时 run_id 是 None——
        那也是「有人在跑」，只有守门的调用方要分辨这一刻，读 run id 的不必。"""
        holder = self.holder(self.read_raw(self.path))
        return holder if self._alive(holder.pid) else None

    def active_run_id(self) -> str | None:
        holder = self.live_holder()
        return holder.run_id if holder is not None else None

    def acquire(self) -> HeldRunLock:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        holder = LockHolder(run_id=None, pid=os.getpid(), started_at=_now())
        token = uuid.uuid4().hex
        content = json.dumps({"runId": None, "pid": holder.pid, "startedAt": holder.started_at, "token": token}) + "\n"
        for _ in range(2):
            try:
                descriptor = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            except FileExistsError:
                raw = self.read_raw(self.path)
                existing = self.holder(raw)
                if raw is None:
                    # O_EXCL publishes the inode before its JSON bytes are fully written.
                    # A concurrent reader must treat that short window as occupied, never stale.
                    raise RunInProgress(existing)
                if raw is not None and self._alive(existing.pid):
                    raise RunInProgress(existing)
                try:
                    self.path.unlink()
                except FileNotFoundError:
                    pass
                continue
            try:
                with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                    handle.write(content)
            except Exception:
                try:
                    self.path.unlink()
                except FileNotFoundError:
                    pass
                raise
            return HeldRunLock(self.path, token, holder)
        raise RunInProgress(self.holder(self.read_raw(self.path)))


@dataclass(frozen=True)
class LaunchReceipt:
    run_id: str
    run_dir: Path


@dataclass(frozen=True)
class BatchReceipt:
    ids: tuple[int, ...]
    spec: str
    pid: int


def compact_ids(ids: Sequence[int]) -> str:
    """题号列表压回 `app.batch --ids` 认的写法；三个以上的连号才压成区间。

    语法的权威是 `app.batch.parse_ids`，但本模块不能 import 它——`app.batch` 反过来
    依赖本模块的 `science125_text`。往返一致由 tests 里的 round-trip 断言钉住。
    规则与前端 `src/batch.ts` 的 `compactIds` 相同：网页上给人看的续跑命令与网页自己
    发起的批次，`--ids` 必须逐字符一致，否则没人能把两者对上。
    """
    ordered = sorted(set(ids))
    parts: list[str] = []
    start = 0
    while start < len(ordered):
        end = start
        while end + 1 < len(ordered) and ordered[end + 1] == ordered[end] + 1:
            end += 1
        if end - start + 1 >= 3:
            parts.append(f"{ordered[start]}-{ordered[end]}")
        else:
            parts.extend(str(ordered[index]) for index in range(start, end + 1))
        start = end + 1
    return ",".join(parts)


class RunLauncher:
    def __init__(
        self,
        runs_root: Path,
        process_factory: ProcessFactory = subprocess.Popen,
        timeout_seconds: float = RUN_TIMEOUT_SECONDS,
    ) -> None:
        self._runs_root = runs_root
        self._lock = FileRunLock(runs_root)
        self._process_factory = process_factory
        self._timeout_seconds = timeout_seconds
        # 批次子进程的句柄。它不是「批次状态」——进度只有 runs/ 说了算，这里只回答
        # 「刚才那个批次还活着吗」，用来守住两次点击之间的空窗：批次在两题之间不持锁，
        # 单看 runs/.active.json 会把那一瞬当成空闲，于是第二次点击就多烧一份 API 费。
        self._batch: ChildProcess | None = None
        self._batch_started = ""

    @property
    def active_run_id(self) -> str | None:
        return self._lock.active_run_id()

    @property
    def timeout_seconds(self) -> float:
        return self._timeout_seconds

    def _batch_holder(self) -> LockHolder | None:
        child = self._batch
        return None if child is None else LockHolder(run_id=None, pid=child.pid, started_at=self._batch_started)

    def start_batch(self, question_ids: Sequence[int]) -> BatchReceipt:
        """把 `python -m app.batch` 起成一个脱离本会话的长子进程。

        这里**不持锁**：锁归每一题各自的 run（`app.cli` 自己抢、自己放）。一个跑几十
        小时的批次若在 HTTP 进程里握着 `runs/.active.json`，第一题就会被批次自己挡住。
        所以本方法只做守门——有活跃 run 或活跃批次就拒绝，其余交给子进程。
        """
        holder = self._lock.live_holder() or self._batch_holder()
        if holder is not None:
            raise RunInProgress(holder)
        spec = compact_ids(question_ids)
        try:
            child = self._process_factory(
                [
                    sys.executable,
                    "-m",
                    "app.batch",
                    "--ids",
                    spec,
                    "--repo-root",
                    str(self._runs_root.parent),
                ],
                cwd=Path(__file__).resolve().parents[2],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                # 单题十几分钟可以跟着 uvicorn 生灭，125 题几十小时不行：关掉浏览器、
                # 重启 uvicorn、退出登录都会把同会话的子进程一起带走。批次自己开一个
                # 会话与进程组，从此只对 runs/ 负责。
                start_new_session=True,
            )
        except Exception as exc:
            raise SpawnFailure(str(exc)) from exc
        self._batch = child
        self._batch_started = _now()
        Thread(target=self._await_batch, args=(child,), daemon=True).start()
        return BatchReceipt(ids=tuple(sorted(set(question_ids))), spec=spec, pid=child.pid)

    def _await_batch(self, child: ChildProcess) -> None:
        """回收子进程并清掉守门用的句柄。批次的进度不经过这里——它在 runs/ 里。"""
        with suppress(Exception):
            child.wait()
        if self._batch is child:
            self._batch = None

    def start(self, text: str, question_id: int | None) -> LaunchReceipt:
        # 批次在两题之间不持锁，那一瞬 acquire() 会成功；单题就此插队，把批次的下一题
        # 顶成 exit 2，连吃两次即触发熔断停批。守门放在抢锁之前。
        batch = self._batch_holder()
        if batch is not None:
            raise RunInProgress(batch)
        lock = self._lock.acquire()
        run_id = ""
        run_dir = self._runs_root
        reserved = False
        try:
            now = datetime.now(UTC)
            for offset in range(60):
                run_id = utc_stamp(now + timedelta(seconds=offset))
                run_dir = self._runs_root / run_id
                try:
                    run_dir.mkdir(parents=False, exist_ok=False)
                except FileExistsError:
                    continue
                reserved = True
                break
            if not reserved:
                raise RuntimeError("60 个候选 run id 均已存在")
            self._write_initial_artifacts(run_dir, text, question_id)
            lock.set_run_id(run_id)
            child = self._process_factory(
                [
                    sys.executable,
                    "-m",
                    "app.cli",
                    "--question",
                    text,
                    "--repo-root",
                    str(self._runs_root.parent),
                    "--run-dir",
                    str(run_dir),
                ],
                cwd=Path(__file__).resolve().parents[2],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            lock.set_pid(child.pid)
        except Exception as exc:
            if reserved:
                self._complete(run_dir, question_id, -1, f"启动子进程失败：{exc}")
            lock.release()
            raise SpawnFailure(str(exc)) from exc
        Thread(target=self._wait, args=(child, lock, run_dir, question_id), daemon=True).start()
        return LaunchReceipt(run_id=run_id, run_dir=run_dir)

    @staticmethod
    def _write_initial_artifacts(run_dir: Path, text: str, question_id: int | None) -> None:
        replace_text(run_dir / "question.md", text + "\n")
        meta: dict[str, object] = {"startedAt": _now()}
        if question_id is not None:
            meta["questionId"] = question_id
        replace_text(run_dir / "meta.json", json.dumps(meta, ensure_ascii=False, indent=2) + "\n")

    def _wait(self, child: ChildProcess, lock: HeldRunLock, run_dir: Path, question_id: int | None) -> None:
        try:
            code = child.wait(timeout=self._timeout_seconds)
            self._complete(run_dir, question_id, code, None if code == 0 else f"app.cli 以 exit {code} 结束")
        except subprocess.TimeoutExpired:
            self._kill(child)
            self._complete(
                run_dir,
                question_id,
                -1,
                f"子进程超过 {self._timeout_seconds:g}s 仍未终态，已被父进程 kill",
                classification="infra_timeout",
            )
        except Exception as exc:
            self._complete(run_dir, question_id, -1, f"等待子进程失败：{exc}", classification="infra_error")
        finally:
            lock.release()

    @staticmethod
    def _kill(child: ChildProcess) -> None:
        with suppress(Exception):
            child.kill()
        with suppress(Exception):
            child.wait(timeout=KILL_GRACE_SECONDS)

    @staticmethod
    def _complete(
        run_dir: Path,
        question_id: int | None,
        exit_code: int,
        failure: str | None,
        classification: str | None = None,
    ) -> None:
        """Settle the run by *merging* into exit.json and meta.json, never by rewriting them.

        Both files are co-written: `app.cli` writes them from inside the pipeline, this
        parent writes them again once it has watched the child exit. The parent's authority
        is exactly the fields it observed itself — `exitCode` and `endedAt`/`finishedAt`,
        plus `questionId` when it reserved the run and `classification` when the child left
        none. Everything else already on disk is the child's fact and is preserved.
        """
        finished = _now()
        # Merge, never rebuild. The child (`app.cli`) writes facts the parent cannot know —
        # `sourceIdentity` above all — and a from-scratch exit.json silently dropped every one
        # of them. The parent overwrites exactly the two fields it decided itself, `exitCode`
        # and `endedAt` (it is the process that watched the child end), plus `classification`
        # when it has one of its own; `app.cli` classifies its own pipeline failures, so the
        # parent's label only fills a gap. Every other key the child wrote survives untouched.
        exit_fact = _read_mapping(run_dir / "exit.json")
        previous = exit_fact.get("classification")
        label = classification or (previous if isinstance(previous, str) else None)
        exit_fact.update({"exitCode": exit_code, "endedAt": finished})
        if label is not None:
            exit_fact["classification"] = label
        replace_text(run_dir / "exit.json", json.dumps(exit_fact, ensure_ascii=False, indent=2) + "\n")
        meta = _read_mapping(run_dir / "meta.json")
        if question_id is not None:
            meta["questionId"] = question_id
        meta.update({"finishedAt": finished, "exitCode": exit_code})
        replace_text(run_dir / "meta.json", json.dumps(meta, ensure_ascii=False, indent=2) + "\n")
        if failure is not None and not (run_dir / "FAILED.md").exists():
            replace_text(run_dir / "FAILED.md", render_failed((failure,), label))


def science125_text(question: Science125Question) -> str:
    return "\n".join(
        [
            f"来源：《Science》125 前沿科学问题（Science-125 题库）第 {question.id} 题，{question.domain}。",
            "",
            f"问题：{question.question}",
            "",
            "任务：围绕该问题识别当前研究的具体知识缺口，生成可验证的科学假设，并给出完整研究计划（10 标准字段）。",
        ]
    )


def freeform_text(question: str) -> str:
    return "\n".join(
        [
            "来源：luup 交付面自由输入。",
            "",
            f"问题：{question.strip()}",
            "",
            "任务：围绕该问题识别当前研究的具体知识缺口，生成可验证的科学假设，并给出完整研究计划（10 标准字段）。",
        ]
    )
