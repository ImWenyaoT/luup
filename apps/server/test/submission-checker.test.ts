import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "bun:test";

import { checkSubmissionFile, mp4DurationSeconds, pdfPageCount } from "../src/submission/checker.ts";

const encoder = new TextEncoder();

function concat(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function box(type: string, payload: Uint8Array): Uint8Array {
  const output = new Uint8Array(8 + payload.byteLength);
  const view = new DataView(output.buffer);
  view.setUint32(0, output.byteLength);
  output.set(encoder.encode(type), 4);
  output.set(payload, 8);
  return output;
}

function mp4WithDuration(seconds: number): Uint8Array {
  const mvhdPayload = new Uint8Array(20);
  const view = new DataView(mvhdPayload.buffer);
  view.setUint32(12, 1_000);
  view.setUint32(16, seconds * 1_000);
  return concat(box("ftyp", encoder.encode("isom")), box("moov", box("mvhd", mvhdPayload)));
}

test("PDF checker accepts a four-part official filename and counts at most 30 pages", () => {
  const pdf = encoder.encode(
    "%PDF-1.7\n/Type /Pages /Count 2\n1 0 obj << /Type /Page >> endobj\n2 0 obj << /Type /Page >> endobj\n%%EOF",
  );
  assert.equal(pdfPageCount(pdf), 2);
  const dir = mkdtempSync(join(tmpdir(), "luup-submission-"));
  try {
    const path = join(dir, "001-学校-申报人-作品名称.pdf");
    writeFileSync(path, pdf);
    const report = checkSubmissionFile(path);
    assert.equal(report.kind, "pdf");
    assert.equal(report.ok, true);
    assert.ok(report.checks.some((check) => check.name === "pdf_pages" && check.state === "pass"));
    assert.ok(report.manualChecks.includes("人工确认作品详情页与视频没有姓名、学校等身份水印。"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("PDF checker fails when the page count is over the official limit", () => {
  const pages = Array.from({ length: 31 }, () => "/Type /Page").join("\n");
  const pdf = encoder.encode(`%PDF-1.7\n${pages}\n%%EOF`);
  assert.equal(pdfPageCount(pdf), 31);
  const dir = mkdtempSync(join(tmpdir(), "luup-submission-"));
  try {
    const path = join(dir, "001-学校-申报人-作品名称.pdf");
    writeFileSync(path, pdf);
    const report = checkSubmissionFile(path);
    assert.equal(report.ok, false);
    assert.ok(report.checks.some((check) => check.name === "pdf_pages" && check.state === "fail"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("MP4 checker reads the movie header duration and rejects videos over ten minutes", () => {
  const video = mp4WithDuration(601);
  assert.equal(mp4DurationSeconds(video), 601);
  const dir = mkdtempSync(join(tmpdir(), "luup-submission-"));
  try {
    const path = join(dir, "001-学校-申报人-作品名称.mp4");
    writeFileSync(path, video);
    const report = checkSubmissionFile(path);
    assert.equal(report.kind, "mp4");
    assert.equal(report.ok, false);
    assert.ok(report.checks.some((check) => check.name === "mp4_duration" && check.state === "fail"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("submission checker does not silently pass an unsupported extension or malformed filename", () => {
  const dir = mkdtempSync(join(tmpdir(), "luup-submission-"));
  try {
    const path = join(dir, "作品.pdf");
    writeFileSync(path, encoder.encode("not a pdf"));
    const report = checkSubmissionFile(path);
    assert.equal(report.ok, false);
    assert.ok(report.checks.some((check) => check.name === "filename" && check.state === "fail"));
    assert.ok(report.checks.some((check) => check.name === "pdf_signature" && check.state === "fail"));

    const pptx = join(dir, "001-学校-申报人-作品名称.pptx");
    writeFileSync(pptx, encoder.encode("pptx"));
    const unsupported = checkSubmissionFile(pptx);
    assert.equal(unsupported.ok, false);
    assert.equal(unsupported.kind, "unknown");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
