import { isRecord } from "./representative-case-parsing.ts";

export function redactSensitiveText(value: string | null): string | null {
  if (value === null) return null;
  return value.replace(
    /(?:[A-Za-z0-9]+[_-])?(?:api[_-]?key|secret|token|authorization|password)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
    "[redacted]",
  );
}

export function sanitizePublic<T>(value: T): T {
  if (typeof value === "string") return redactSensitiveText(value) as unknown as T;
  if (Array.isArray(value)) return value.map((item) => sanitizePublic(item)) as unknown as T;
  if (isRecord(value)) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (/prompt|internal_rationale|api_key|token/i.test(k)) continue;
      result[k] = sanitizePublic(v);
    }
    return result as unknown as T;
  }
  return value;
}
