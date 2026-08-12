import { afterEach, describe, expect, it } from "bun:test"
import { ApiFailure, api } from "./api"
import { client } from "./client/client.gen"

/**
 * api.ts 有两条错误归一化路径：
 *   A. 手写的 `json()` / `artifact()`——直接 fetch，自己兜 JSON 解析失败；
 *   B. 生成 client 的 `generated()`——hey-api 先把失败塞进 `{ error, response }`。
 * 这里对同一组失败形态分别打两条路径，看它们各自归一成什么。
 *
 * 生成 client 会 `new Request(url)`，相对路径在非浏览器环境解析不了，
 * 所以给它一个绝对 baseUrl；手写路径不构造 Request，保持默认的同源相对路径。
 */
client.setConfig({ baseUrl: "http://api.test" })

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

type Call = { url: string; init?: RequestInit }
const calls: Call[] = []

/** 记录请求并按脚本回复；入参可能是 string（手写路径）或 Request（生成 client）。 */
function serve(reply: () => Response | Promise<Response>) {
  calls.length = 0
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: input instanceof Request ? input.url : String(input),
      init: input instanceof Request ? input : init,
    })
    return await reply()
  }) as typeof fetch
}

function failTransport(message: string) {
  calls.length = 0
  globalThis.fetch = (async () => {
    throw new TypeError(message)
  }) as unknown as typeof fetch
}

const jsonBody = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })

const textBody = (status: number, body: string) =>
  new Response(body, { status, headers: { "content-type": "text/plain" } })

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error("期望被拒绝，但 resolve 了")
}

describe("手写 json() 路径", () => {
  it("2xx + JSON 体：原样交出解析结果，并带上 accept 头", async () => {
    serve(() => jsonBody(200, { runId: "20260810-092300", status: "working" }))
    await expect(api.start({ question: "q" })).resolves.toEqual({
      runId: "20260810-092300",
      status: "working",
    })
    expect(calls[0]?.url).toBe("/api/runs")
    expect(calls[0]?.init?.method).toBe("POST")
    expect(calls[0]?.init?.body).toBe('{"question":"q"}')
  })

  it("非 2xx + JSON 体：抛 ApiFailure，状态码与后端的 error/code 全部保留", async () => {
    // 409 携带 activeRunId 是「已有 run 在跑」的契约，UI 要能读到它。
    serve(() =>
      jsonBody(409, {
        error: "已有 run 在运行",
        code: "run_active",
        activeRunId: "20260810-092300",
      }),
    )
    const error = (await rejection(api.start({ question: "q" }))) as ApiFailure
    expect(error).toBeInstanceOf(ApiFailure)
    expect(error.status).toBe(409)
    expect(error.body.code).toBe("run_active")
    expect(error.body.activeRunId).toBe("20260810-092300")
    expect(error.message).toBe("已有 run 在运行")
  })

  it("非 2xx + 非 JSON 体：归一成 bad_response，消息退成 HTTP <状态码>", async () => {
    // 网关吐 HTML 错误页时，页面上不能出现半页 HTML。
    serve(() => textBody(502, "<html>Bad Gateway</html>"))
    const error = (await rejection(api.start({ question: "q" }))) as ApiFailure
    expect(error).toBeInstanceOf(ApiFailure)
    expect(error.status).toBe(502)
    expect(error.body).toEqual({ error: "HTTP 502", code: "bad_response" })
    expect(error.message).toBe("HTTP 502")
  })

  it("非 2xx + 空体：与非 JSON 体归一到同一形态", async () => {
    serve(() => new Response(null, { status: 503 }))
    const error = (await rejection(api.start({ question: "q" }))) as ApiFailure
    expect(error.status).toBe(503)
    expect(error.body).toEqual({ error: "HTTP 503", code: "bad_response" })
  })

  it("错误体的 error 为空串时，消息退回 HTTP <状态码> 而不是空白", async () => {
    serve(() => jsonBody(500, { error: "", code: "boom" }))
    const error = (await rejection(api.start({ question: "q" }))) as ApiFailure
    expect(error.message).toBe("HTTP 500")
    expect(error.body.code).toBe("boom")
  })

  it("2xx + 非 JSON 体：抛错，不把兜底对象冒充成业务数据", async () => {
    // 200 但体不是 JSON，说明契约破了。返回 `{error,code}` 冒充 `{runId,status}`
    // 只会让调用方读到 undefined 的 runId，错误要在这里就被看见。
    serve(() => textBody(200, "not json"))
    const error = (await rejection(api.start({ question: "q" }))) as ApiFailure
    expect(error).toBeInstanceOf(ApiFailure)
    expect(error.status).toBe(200)
    expect(error.body).toEqual({ error: "HTTP 200", code: "bad_response" })
  })
})

describe("artifact() 路径", () => {
  it("2xx：工件正文按文本原样交出，不做 JSON 解析", async () => {
    // 工件既有 markdown 又有 JSON，统一按文本取，渲染层再决定怎么排版。
    serve(() => textBody(200, "# evidence\n\n正文"))
    await expect(api.artifact("20260810-092300", "evidence.md")).resolves.toBe(
      "# evidence\n\n正文",
    )
  })

  it("run id 与文件名都做 URL 编码，斜杠不会被当成路径段", async () => {
    // memory/papers/xxx.md 这类嵌套工件名必须整体进 query，不能劈开 URL。
    serve(() => textBody(200, "ok"))
    await api.artifact("2026 08", "memory/papers/a b.md")
    expect(calls[0]?.url).toBe(
      "/api/runs/2026%2008?artifact=memory%2Fpapers%2Fa%20b.md",
    )
  })

  it("非 2xx + JSON 体：抛 ApiFailure 并保留后端的 error/code", async () => {
    serve(() => jsonBody(404, { error: "工件不存在", code: "not_found" }))
    const error = (await rejection(
      api.artifact("20260810-092300", "nope.md"),
    )) as ApiFailure
    expect(error.status).toBe(404)
    expect(error.body).toEqual({ error: "工件不存在", code: "not_found" })
  })

  it("非 2xx + 非 JSON 体：兜底 code 是 artifact_failed，与 json() 路径可区分", async () => {
    serve(() => textBody(404, "Not Found"))
    const error = (await rejection(
      api.artifact("20260810-092300", "nope.md"),
    )) as ApiFailure
    expect(error.body).toEqual({ error: "HTTP 404", code: "artifact_failed" })
  })
})

describe("生成 client 的 generated() 路径", () => {
  it("2xx：只交出 data，不把 response 泄露给调用方", async () => {
    serve(() => jsonBody(200, { active: null, runs: [] }))
    await expect(api.runs()).resolves.toEqual({ active: null, runs: [] })
  })

  it("非 2xx + JSON 体：与手写路径归一到同一个 ApiFailure 形态", async () => {
    serve(() => jsonBody(404, { error: "run 不存在", code: "not_found" }))
    const error = (await rejection(api.detail("nope"))) as ApiFailure
    expect(error).toBeInstanceOf(ApiFailure)
    expect(error.status).toBe(404)
    expect(error.body.code).toBe("not_found")
    expect(error.message).toBe("run 不存在")
  })

  it("非 2xx + 非 JSON 体：状态码保留，消息退成 HTTP <状态码>", async () => {
    serve(() => textBody(502, "<html>Bad Gateway</html>"))
    const error = (await rejection(api.runs())) as ApiFailure
    expect(error).toBeInstanceOf(ApiFailure)
    expect(error.status).toBe(502)
    expect(error.message).toBe("HTTP 502")
  })

  it("非 2xx + 空体：状态码保留，消息退成 HTTP <状态码>", async () => {
    serve(() => new Response(null, { status: 500 }))
    const error = (await rejection(api.runs())) as ApiFailure
    expect(error.status).toBe(500)
    expect(error.message).toBe("HTTP 500")
  })

  it("2xx + 半截 JSON：抛 ApiFailure，不 resolve 成 undefined", async () => {
    // hey-api 把 JSON.parse 失败塞进 error、data 留空。只看 response.ok 就会
    // resolve 出 undefined，崩在下游 `data.runs.map` 上而不是 ErrorBox 里。
    serve(
      () =>
        new Response('{"runs": [', {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    )
    const error = (await rejection(api.runs())) as ApiFailure
    expect(error).toBeInstanceOf(ApiFailure)
    expect(error.status).toBe(200)
    expect(error.body).toEqual({ error: "HTTP 200", code: "bad_response" })
  })
})

describe("两条路径对同一故障的一致性", () => {
  it("传输层失败：保留真实成因，不伪造 HTTP 状态码，三个入口说同一句话", async () => {
    // 断网不是服务端 500。之前手写路径抛 TypeError("Failed to fetch")、
    // 生成 client 路径抛 ApiFailure(500, TypeError) 消息 "HTTP 500"——
    // 同一次断网，用户看到的错因取决于点了哪个按钮。
    const attempts: Array<() => Promise<unknown>> = [
      () => api.start({ question: "q" }),
      () => api.artifact("20260810-092300", "evidence.md"),
      () => api.runs(),
    ]
    for (const attempt of attempts) {
      failTransport("Failed to fetch")
      const error = (await rejection(attempt())) as ApiFailure
      expect(error).toBeInstanceOf(ApiFailure)
      // 0 = 没走到服务端；任何真实状态码都会把断网说成服务端的错。
      expect(error.status).toBe(0)
      expect(error.body).toEqual({
        error: "Failed to fetch",
        code: "network_error",
      })
      expect(error.message).toBe("Failed to fetch")
    }
  })
})
