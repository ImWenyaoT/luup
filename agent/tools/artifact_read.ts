/**
 * 读本次 run 的 handoff 工件。与 artifact_write 共用同一套路径 jail。
 */
import { defineTool } from "eve/tools";
import { z } from "zod";
import { ArtifactPathError, readArtifact } from "../lib/artifacts.ts";

export default defineTool({
  description:
    "Read one artifact from this run's directory (or list a directory, e.g. `verdicts`). " +
    "Paths are ALWAYS relative to the run directory; absolute paths and `..` are rejected. " +
    "If the path does not exist you get the list of artifacts that do.",
  inputSchema: z.object({
    path: z
      .string()
      .min(1)
      .describe('Run-relative path, e.g. "evidence.md", "verdicts", "memory/rejected.md".'),
  }),
  async execute({ path }) {
    try {
      return readArtifact(path);
    } catch (e) {
      if (e instanceof ArtifactPathError) {
        return { path, kind: "rejected" as const, exists: false, error: e.message };
      }
      throw e;
    }
  },
});
