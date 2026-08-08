/** 交付面是本地评审工具，任何缓存都是在骗人——统一 no-store。 */
const NO_STORE = {
  "cache-control": "no-store, no-cache, must-revalidate",
  "content-type": "application/json; charset=utf-8",
};

export function json(body: unknown, status = 200, extra?: Record<string, string>): Response {
  return new Response(`${JSON.stringify(body, null, 2)}\n`, {
    status,
    headers: { ...NO_STORE, ...extra },
  });
}

export function fail(status: number, code: string, error: string, extra?: Record<string, unknown>): Response {
  return json({ error, code, ...extra }, status);
}

/** 工件正文固定 text/plain：不返 text/html 就没有反射 XSS 的面。 */
export function text(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "cache-control": "no-store, no-cache, must-revalidate",
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}
