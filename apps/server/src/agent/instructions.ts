import { readFileSync } from "node:fs";
import { join } from "node:path";

/** 提示词放在 Markdown 里，初学者不用钻进 TypeScript 字符串找正文。 */
export function instructionsFrom(dir: string, filename: string): string {
  return readFileSync(join(dir, filename), "utf8").trim();
}
