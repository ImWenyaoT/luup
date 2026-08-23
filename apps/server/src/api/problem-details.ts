/** RFC 9457 Problem Details 规范的结构化错误响应。
 *
 * 为 AI Agent 提供稳定的机器可读错误码（code）、人类可读原因（detail）与可执行的恢复建议（resolution），
 * 响应类型为 `application/problem+json`，同时保留 `detail` 兼容既有客户端。
 */

export type ProblemOptions = {
  code: string;
  title: string;
  detail: string;
  resolution?: string;
  instance?: string;
  extraHeaders?: Record<string, string>;
};

export function problemResponse(status: number, options: ProblemOptions): Response {
  const body = {
    type: `https://is-agentic.com/errors/${options.code}`,
    title: options.title,
    status,
    detail: options.detail,
    code: options.code,
    ...(options.resolution ? { resolution: options.resolution } : {}),
    ...(options.instance ? { instance: options.instance } : {}),
  };

  return Response.json(body, {
    status,
    headers: {
      "content-type": "application/problem+json; charset=utf-8",
      ...options.extraHeaders,
    },
  });
}
