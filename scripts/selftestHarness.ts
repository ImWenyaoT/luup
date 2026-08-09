/**
 * 五个 selftest 共用的断言与计分。**不是测试框架**：只有三个动词，没有 describe、
 * 没有 before/after、没有插件面。
 *
 * 收编前每个 selftest 各自抄一份 check/eq 与结尾的计数打印，于是同一件事有五种输出格式
 * （PASS/FAIL 与 ✔/✘ 各两派）、五份退出码逻辑；改一处断言口径要改五个文件，谁也不敢改。
 * 计分状态是模块级的：一个 selftest 就是一个进程，进程里只有一份分数。
 *
 * 用法：
 *
 *   import { check, eq, report } from "./selftestHarness.ts";
 *   check("锁文件落盘", existsSync(LOCK_FILE));
 *   eq("锁记的是自己的 pid", readLock()?.pid, process.pid);
 *   report("selftest-lock");   // 打印汇总并按失败数退出，不返回
 *
 * `report()` 之前请自己收拾现场（删临时目录、恢复 env）—— 它会终止进程。
 */

let passed = 0;
const failures: string[] = [];

/** 一条断言。`detail` 只在失败时打印 —— 通过的那些不该刷屏。 */
export function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    passed += 1;
    console.log(`  ✔ ${name}`);
  } else {
    failures.push(name);
    console.error(`  ✘ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** 相等断言（Object.is）。期望值与实际值自动进 detail，调用方不必手写。 */
export function eq<T>(name: string, actual: T, expected: T): void {
  check(name, Object.is(actual, expected), `期望 ${String(expected)}，实际 ${String(actual)}`);
}

/** 汇总 + 退出码：一条都不许挂。 */
export function report(label: string): never {
  console.log(`\n[${label}] ${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) console.log(failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(failures.length === 0 ? 0 : 1);
}
