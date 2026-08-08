import { type ChildProcess, spawn } from "node:child_process";
import { type WriteStream, createWriteStream, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { release, setRunId } from "./lock.ts";
import { RUNS_DIR, REPO_ROOT, isRunId } from "./paths.ts";

/** 提问模板的单一事实源在 lib/questionText.ts；这里只是交付面的转出口。 */
export { freeformText, science125Text } from "./questionText.ts";

/**
 * 路径在运行期从 REPO_ROOT 拼出来，不是字面量：打包器看到 spawn("node", ["scripts/run.ts"])
 * 会当成模块引用去解析并报 Module not found。process.execPath 顺带避开 PATH 差异。
 */
const PIPELINE_SCRIPT = join(REPO_ROOT, "scripts", "run.ts");

const RUN_DIR_LINE = /\[luup\] run dir : (.+)/;
/** 拿到 runId 之前的输出先进内存；上限防止 pipeline 早期狂刷把服务撑爆。 */
const BUFFER_LIMIT = 64 * 1024;
/** run.ts 建目录 + 打印是同步的，10s 还没打印说明起不来。 */
const RUN_DIR_TIMEOUT_MS = 10_000;

export class SpawnFailure extends Error {}

type Started = { runId: string; runDir: string; child: ChildProcess };

/**
 * 起 pipeline 子进程并在拿到 run 目录的那一刻返回——不等它跑完（单 run 10~20 分钟）。
 * 之后的 stdout/stderr 直落 runs/<id>/console.log，前端靠轮询文件系统看进度。
 */
/**
 * LUUP_QUESTION_ID 必须显式置位或删除，绝不能继承 server 自身的环境：
 * 若启服务的 shell 里残留一个值，自由输入的 run 会被写上错误的题号，
 * run-batch 的续跑索引（meta.questionId）随即误判该题已交付。
 */
function childEnv(questionId: number | null): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (questionId === null) delete env.LUUP_QUESTION_ID;
  else env.LUUP_QUESTION_ID = String(questionId);
  return env;
}

export function startRun(text: string, questionId: number | null): Promise<Started> {
  return new Promise<Started>((resolveStart, rejectStart) => {
    const child = spawn(process.execPath, [PIPELINE_SCRIPT, text], {
      cwd: REPO_ROOT,
      detached: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: childEnv(questionId),
    });

    let buffer = "";
    let runId: string | null = null;
    let log: WriteStream | null = null;
    let settled = false;

    /** 释放只针对本次启动持有的那把锁：三个回调可能先后触发，迟到的一次必须是 no-op。 */
    const releaseMine = () => release({ pid: process.pid, runId });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      releaseMine();
      rejectStart(new SpawnFailure("10s 内未从 scripts/run.ts 拿到 run 目录"));
    }, RUN_DIR_TIMEOUT_MS);

    const absorb = (chunk: Buffer) => {
      const s = chunk.toString("utf8");
      if (log) {
        log.write(s);
        return;
      }
      buffer = (buffer + s).slice(-BUFFER_LIMIT);
      if (runId !== null) return;
      const hit = RUN_DIR_LINE.exec(buffer);
      if (!hit) return;

      const dir = resolve(hit[1].trim());
      const id = basename(dir);
      // 目录必须真的落在 runs/ 里且是合法 run id，否则宁可失败也不写文件
      if (!isRunId(id) || dirname(dir) !== RUNS_DIR) return;

      runId = id;
      clearTimeout(timer);
      setRunId(id);
      try {
        log = createWriteStream(`${dir}/console.log`, { flags: "a" });
        log.write(buffer);
      } catch {
        log = null; // 落不了盘不影响 run 本身，日志尾会为空
      }
      if (!settled) {
        settled = true;
        resolveStart({ runId: id, runDir: dir, child });
      }
    };

    child.stdout?.on("data", absorb);
    child.stderr?.on("data", absorb);

    child.on("error", (err) => {
      clearTimeout(timer);
      releaseMine();
      if (!settled) {
        settled = true;
        rejectStart(new SpawnFailure(`spawn 失败：${err.message}`));
      }
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (runId !== null) {
        try {
          writeFileSync(
            `${RUNS_DIR}/${runId}/exit.json`,
            `${JSON.stringify({ exitCode: code ?? -1, endedAt: new Date().toISOString() }, null, 2)}\n`,
            "utf8",
          );
        } catch {
          /* 目录可能已被删；释放锁更重要 */
        }
      }
      log?.end();
      releaseMine();
      if (!settled) {
        settled = true;
        rejectStart(new SpawnFailure(`scripts/run.ts 未产出 run 目录即退出（exit ${code}）`));
      }
    });
  });
}
