import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { PaperDraft } from "./types.ts";

export type PaperStore = {
  save(paper: PaperDraft): { path: string };
};

/** 把 verified Paper 落到 `outputs/papers/`（产量可盘点；形制学 explore 建议）。 */
export function createFsPaperStore(rootDir: string = join(process.cwd(), "outputs", "papers")): PaperStore {
  return {
    save(paper) {
      mkdirSync(rootDir, { recursive: true });
      const path = join(rootDir, `${paper.id}.md`);
      const frontmatter = [
        "---",
        `id: ${paper.id}`,
        `ticketId: ${paper.ticketId}`,
        `title: ${JSON.stringify(paper.title)}`,
        `createdAt: ${paper.createdAt}`,
        `evidenceIds: ${JSON.stringify(paper.evidenceIds)}`,
        "---",
        "",
      ].join("\n");
      writeFileSync(path, `${frontmatter}${paper.bodyMarkdown}\n`, "utf8");
      return { path };
    },
  };
}

/** 测试用：只记内存路径。 */
export function createMemoryPaperStore(): PaperStore & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    save(paper) {
      const path = `memory://${paper.id}.md`;
      files.set(path, paper.bodyMarkdown);
      return { path };
    },
  };
}
