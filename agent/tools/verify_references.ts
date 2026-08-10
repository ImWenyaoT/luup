/**
 * 引用真实性的确定性核验（criteria B）—— master 的终审闸门。
 *
 * 拜占庭假设（architecture.md 防线第 3 条）：本工具不看任何 agent 的推理过程，
 * 只拿最终 references 条目 ⑴ 比对本 run 的 memory/papers/、⑵ 反查 arXiv 核对标题。
 * 判据与 scripts/verify-proposal.ts 一致，实现走 agent/lib/verifyRefs.ts。
 */
import { tool } from "@openai/agents";
import { z } from "zod";
import { ArtifactPathError } from "../lib/artifacts.ts";
import { verifyProposalFile } from "../lib/verifyRefs.ts";

const parameters = z.object({
  path: z
    .string()
    .min(1)
    .default("proposal.json")
    .describe("Run-relative path of the proposal artifact to verify."),
});

/** 裸执行函数：selftest 直调它，不经 SDK 的 RunContext。 */
export async function executeVerifyReferences({ path }: z.infer<typeof parameters>) {
  try {
    const result = await verifyProposalFile(path);
    return {
      ...result,
      hint: result.ok
        ? "全部通过：契约完整且引用逐条可反查。"
        : `未通过 ${result.failed.length} 项：${result.failed.join(", ")}。A.schema 失败回 proposal 节点补字段；B1 失败说明引用未经 arxiv_save 落盘（多半是编造）；B2 失败说明标题与 arXiv 不符；B4 失败说明作者/年份是凭记忆编的 —— 让 proposal 节点照抄 memory/papers/ 中的元数据重出。`,
    };
  } catch (e) {
    if (e instanceof ArtifactPathError) {
      return { artifact: path, ok: false, schemaOk: false, schemaIssues: [e.message], checks: [], failed: ["path"], hint: "路径被拒绝。" };
    }
    throw e;
  }
}

export default tool({
  name: "verify_references",
  description:
    "Deterministically verify a proposal artifact: the 10-field contract (A), plus reference authenticity — " +
    "every arXiv id must have been saved into THIS run's literature memory (B1), each id is re-resolved " +
    "against the live arXiv API and its title must match the one in the proposal with >=0.8 token overlap (B2), " +
    "there must be at least 5 references (B3), and each reference's authors and year must match the metadata arXiv returned into this run's memory (B4 — titles are easy to copy correctly while author lists get invented from memory). No LLM involved and no reasoning is inspected: invented or " +
    "second-hand citations fail here regardless of how well they are argued. Run this before declaring success.",
  parameters,
  execute: executeVerifyReferences,
});
