// signal.reason 在 lib.dom 里是 any，类型层证不出它是 Error，但它正是取消语义要
// 传播的那个值（默认是 AbortError DOMException）。换成自造 Error 会把上游的取消
// 原因抹掉，取消和真错误就分不开了 —— 这里要的就是原样透传。
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(done, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    function done() {
      signal?.removeEventListener("abort", abort);
      resolve();
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/** 进程级的同源发号闸。
 *
 * 每个来源一个实例、模块级持有：不管有多少个角色或 Run 在并发检索，同一个源的
 * 请求都排在同一条队上。绕过它直连会把整台机器的 IP 打进对方的临时封禁 ——
 * arXiv 的表现是连响应都不给（不是 429），且要等它自己过期。
 *
 * 用 promise 链串行化而不是「记一个时间戳」：后者在并发调用下会让多个请求
 * 同时读到同一个「已经等够了」，一起挤出去。
 */
export function createRateLimiter(defaultIntervalMs: number) {
  let queue: Promise<void> = Promise.resolve();
  let lastCallAt = 0;

  return function acquire(intervalMs: number = defaultIntervalMs, signal?: AbortSignal): Promise<void> {
    const turn = queue.then(async () => {
      signal?.throwIfAborted();
      const waiting = intervalMs - (Date.now() - lastCallAt);
      if (waiting > 0) await sleep(waiting, signal);
      signal?.throwIfAborted();
      lastCallAt = Date.now();
    });
    queue = turn.catch(() => undefined);
    return turn;
  };
}
