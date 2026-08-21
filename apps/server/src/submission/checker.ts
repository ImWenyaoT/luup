import { basename, extname, resolve } from "node:path";
import { readFileSync, statSync } from "node:fs";

export const SUBMISSION_LIMITS = {
  maxPdfBytes: 200 * 1024 * 1024,
  maxPdfPages: 30,
  maxVideoSeconds: 10 * 60,
} as const;

export type SubmissionCheckState = "pass" | "fail" | "unknown";

export type SubmissionCheck = {
  name: string;
  state: SubmissionCheckState;
  detail: string;
};

export type SubmissionKind = "pdf" | "mp4" | "unknown";

export type SubmissionReport = {
  path: string;
  filename: string;
  kind: SubmissionKind;
  ok: boolean;
  checks: SubmissionCheck[];
  manualChecks: string[];
};

const encoder = new TextEncoder();
const decoder = new TextDecoder("latin1");
const OFFICIAL_NAME_PARTS = 4;

function check(name: string, state: SubmissionCheckState, detail: string): SubmissionCheck {
  return { name, state, detail };
}

function nonEmptyOfficialFilename(filename: string): SubmissionCheck {
  const stem = basename(filename, extname(filename));
  const parts = stem.split("-");
  const valid =
    parts.length >= OFFICIAL_NAME_PARTS &&
    parts.slice(0, 3).every((part) => part.trim() !== "") &&
    parts.slice(3).join("-").trim() !== "";
  return valid
    ? check("filename", "pass", "文件名至少包含编号、学校、申报人姓名、作品名称四段。")
    : check("filename", "fail", "文件名应为“编号-学校-申报人姓名-作品名称”，且四段均不能为空。 ");
}

function hasPrefix(bytes: Uint8Array, prefix: string): boolean {
  const expected = encoder.encode(prefix);
  if (bytes.byteLength < expected.byteLength) return false;
  return expected.every((value, index) => bytes[index] === value);
}

/**
 * Count leaf Page nodes in a regular, uncompressed PDF page tree.
 *
 * This intentionally returns null when no page object is visible rather than
 * guessing. A compressed/object-stream PDF must be checked by a PDF viewer or
 * `pdfinfo` before submission; it never silently passes the page gate.
 */
export function pdfPageCount(bytes: Uint8Array): number | null {
  const text = decoder.decode(bytes);
  const matches = text.match(/\/Type\s*\/Page(?!s)(?=\s|\/|>|$)/g);
  return matches?.length ?? null;
}

type Mp4Box = {
  type: string;
  payloadStart: number;
  payloadEnd: number;
  next: number;
};

function readAscii(bytes: Uint8Array, start: number, length: number): string {
  return decoder.decode(bytes.subarray(start, start + length));
}

function readMp4Box(bytes: Uint8Array, offset: number, end: number): Mp4Box | null {
  if (offset + 8 > end) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const declaredSize = view.getUint32(offset);
  const type = readAscii(bytes, offset + 4, 4);
  let headerSize = 8;
  let size: number;
  if (declaredSize === 1) {
    if (offset + 16 > end) return null;
    const extended = view.getBigUint64(offset + 8);
    if (extended > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    size = Number(extended);
    headerSize = 16;
  } else if (declaredSize === 0) {
    size = end - offset;
  } else {
    size = declaredSize;
  }
  if (size < headerSize || size > end - offset) return null;
  return { type, payloadStart: offset + headerSize, payloadEnd: offset + size, next: offset + size };
}

const MP4_CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl", "edts", "udta"]);

function findMvhd(bytes: Uint8Array, start: number, end: number, depth = 0): Mp4Box | null {
  if (depth > 8) return null;
  let offset = start;
  while (offset < end) {
    const box = readMp4Box(bytes, offset, end);
    if (!box) return null;
    if (box.type === "mvhd") return box;
    if (MP4_CONTAINERS.has(box.type)) {
      const nested = findMvhd(bytes, box.payloadStart, box.payloadEnd, depth + 1);
      if (nested) return nested;
    }
    offset = box.next;
  }
  return null;
}

/** Read the ISO-BMFF movie duration without relying on ffmpeg or a native binary. */
export function mp4DurationSeconds(bytes: Uint8Array): number | null {
  const mvhd = findMvhd(bytes, 0, bytes.byteLength);
  if (!mvhd || mvhd.payloadStart + 4 > mvhd.payloadEnd) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = bytes[mvhd.payloadStart];
  const fullBoxData = mvhd.payloadStart + 4;
  let timeScaleOffset: number;
  let durationOffset: number;
  if (version === 0) {
    timeScaleOffset = fullBoxData + 8;
    durationOffset = fullBoxData + 12;
  } else if (version === 1) {
    timeScaleOffset = fullBoxData + 16;
    durationOffset = fullBoxData + 20;
  } else {
    return null;
  }
  if (durationOffset + (version === 0 ? 4 : 8) > mvhd.payloadEnd) return null;
  const timeScale = view.getUint32(timeScaleOffset);
  const duration = version === 0 ? view.getUint32(durationOffset) : Number(view.getBigUint64(durationOffset));
  if (timeScale === 0 || !Number.isSafeInteger(duration)) return null;
  return duration / timeScale;
}

function validatePdf(bytes: Uint8Array): SubmissionCheck[] {
  const checks: SubmissionCheck[] = [
    check(
      "pdf_signature",
      hasPrefix(bytes, "%PDF-") ? "pass" : "fail",
      hasPrefix(bytes, "%PDF-") ? "检测到 PDF 文件头。" : "文件不是可识别的 PDF。",
    ),
  ];
  const pages = pdfPageCount(bytes);
  checks.push(
    pages === null
      ? check("pdf_pages", "unknown", "未找到可解析的 Page 节点；请用 PDF 阅读器或 pdfinfo 人工复核页数。")
      : check(
          "pdf_pages",
          pages <= SUBMISSION_LIMITS.maxPdfPages ? "pass" : "fail",
          `检测到 ${pages} 页；官方上限为 ${SUBMISSION_LIMITS.maxPdfPages} 页。`,
        ),
  );
  return checks;
}

function validateMp4(bytes: Uint8Array): SubmissionCheck[] {
  const firstBox = readMp4Box(bytes, 0, bytes.byteLength);
  const signature = firstBox?.type === "ftyp";
  const checks: SubmissionCheck[] = [
    check(
      "mp4_signature",
      signature ? "pass" : "fail",
      signature ? "检测到 MP4/ISO-BMFF ftyp 文件头。" : "文件不是可识别的 MP4。",
    ),
  ];
  const duration = mp4DurationSeconds(bytes);
  checks.push(
    duration === null
      ? check("mp4_duration", "unknown", "未能从 mvhd 读取时长；请用播放器或 ffprobe 人工复核。")
      : check(
          "mp4_duration",
          duration <= SUBMISSION_LIMITS.maxVideoSeconds ? "pass" : "fail",
          `检测到 ${duration.toFixed(3)} 秒；官方上限为 ${SUBMISSION_LIMITS.maxVideoSeconds} 秒。`,
        ),
  );
  return checks;
}

function kindOf(filename: string): SubmissionKind {
  switch (extname(filename).toLowerCase()) {
    case ".pdf":
      return "pdf";
    case ".mp4":
      return "mp4";
    default:
      return "unknown";
  }
}

export function checkSubmissionFile(path: string): SubmissionReport {
  const absolutePath = resolve(path);
  const filename = basename(absolutePath);
  const kind = kindOf(filename);
  const checks: SubmissionCheck[] = [nonEmptyOfficialFilename(filename)];
  const manualChecks = [
    "人工确认作品详情页与视频没有姓名、学校等身份水印。",
    "人工确认两页盖章报名表截图、Qwen 调用凭证和真实批跑证据已随材料提供。",
  ];

  let bytes: Uint8Array | null = null;
  try {
    const size = statSync(absolutePath).size;
    if (kind === "pdf") {
      const withinLimit = size <= SUBMISSION_LIMITS.maxPdfBytes;
      checks.push(
        check(
          "file_size",
          withinLimit ? "pass" : "fail",
          `文件大小 ${(size / 1024 / 1024).toFixed(2)} MiB；官方上限为 200 MiB。`,
        ),
      );
      if (withinLimit) bytes = readFileSync(absolutePath);
    } else {
      checks.push(
        check("file_size", "pass", `文件大小 ${(size / 1024 / 1024).toFixed(2)} MiB；视频未规定文件大小上限。`),
      );
      bytes = readFileSync(absolutePath);
    }
  } catch (error) {
    checks.push(check("file_read", "fail", `文件无法读取：${error instanceof Error ? error.message : String(error)}`));
  }

  if (kind === "pdf")
    checks.push(
      ...(bytes
        ? validatePdf(bytes)
        : [
            check("pdf_signature", "unknown", "文件超过大小上限或无法读取，未继续解析。"),
            check("pdf_pages", "unknown", "未继续解析页数。"),
          ]),
    );
  else if (kind === "mp4")
    checks.push(
      ...(bytes
        ? validateMp4(bytes)
        : [
            check("mp4_signature", "unknown", "文件无法读取，未继续解析。"),
            check("mp4_duration", "unknown", "未继续解析时长。"),
          ]),
    );
  else checks.push(check("extension", "fail", "仅自动检查 .pdf 和 .mp4；PPTX/DOCX 请先导出 PDF 再检查页数。"));

  return {
    path: absolutePath,
    filename,
    kind,
    ok: checks.every((item) => item.state === "pass"),
    checks,
    manualChecks,
  };
}

function main(): void {
  const path = process.argv[2];
  if (!path) {
    process.stderr.write("用法：bun run submission:check -- <作品.pdf|演示.mp4>\n");
    process.exit(2);
  }
  const report = checkSubmissionFile(path);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) main();
