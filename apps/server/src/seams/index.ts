/** 接缝索引：换实现时要动的地方，全在这里点名。
 *
 * 「接缝」不是一层抽象，是一句承诺 —— 这几个位置的实现可以整块换掉，换的人只需要满足
 * 下面写的那份约定，不必读 harness。所以这里只有类型与一个工厂，没有注册表、没有容器：
 * luup 目前每个接缝**只有一个**生产实现加一个离线替身，两个实现撑不起一层调度机制。
 *
 * 已明确不做的：guard 注册表、provider 分层作用域。见 `docs/design/dsh-borrowings.md`。
 */

import type { CampaignMemory } from "../campaign/campaign.ts";
import type { SqliteStore } from "../store/store.ts";
import type { ReferenceVerifier } from "../verify/verifier.ts";

export {
  modelConfigStatus,
  modelConfigVersion,
  modelForRole,
  qwenModelProvider,
  setModelOverride,
  sharedModelSettings,
} from "./model.ts";

/** 终局引用验收。
 *
 * 现有 provider：`createReferenceVerifier()`（打 arXiv 官方 API），
 * 以及它注入离线反查后的替身（`createDeterministicVerifier()`、测试 fixture）。
 * 换实现要满足：**不问模型**，只看冻结 Artifact 与外部权威源；
 * 反查不通要在结果里标成 `infraError`，不能给引用扣造假的帽子。
 */
export type Verifier = ReferenceVerifier;

/** Run 记账面。Harness 用到的全部方法就是下面这些，接缝宽度即此。
 *
 * 现有 provider：`SqliteStore`（bun:sqlite，单写者锁，重开即判 interrupted）。
 * 换实现要满足：运行中 append-only、终态后不可变；事件序号单调递增；
 * 失败的 Attempt 也要留下它查过的证据与烧掉的用量。
 */
export type RunStore = Pick<
  SqliteStore,
  | "createRun"
  | "question"
  | "science125Id"
  | "startAttempt"
  | "publishArtifact"
  | "failAttempt"
  | "finishRun"
  | "emit"
  | "latestArtifact"
  | "eventsAfter"
  | "recordEvidence"
>;

/** 跨 run 的战役记忆通道。
 *
 * 现有 provider：`CampaignMemory`（`memory/` 下的 Markdown 文件制，原子改名写入）。
 * 换实现要满足：读是确定性的（同一目录同一输入必得同一结果）、写是幂等追加；
 * 目录不存在是显式 disabled，I/O 故障必须返回 unavailable 并进入 Run 诊断，绝不因此打死 run。
 * 传 `null` 即消融臂：不注入也不写回。
 */
export type CampaignMemoryPort = Pick<CampaignMemory, "readPriorAttempts" | "recordRun">;
