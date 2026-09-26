/**
 * One retry for transient provider failures: rate limits (429), server
 * errors (5xx) and dropped connections. A second failure is handed back to
 * the caller; beyond that the player's own retry takes over.
 */

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
/** Wait before retrying when the provider doesn't say: 1–2 s, jittered so callers don't retry in lockstep. */
const baseDelay = () => 1_000 + Math.random() * 1_000;

/** Retry-After as milliseconds from now: either seconds, or an HTTP date. */
function retryAfterMs(res: Response): number | null {
  const value = res.headers.get("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (signal?.aborted) return abort();
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export async function fetchWithRetry(
  send: () => Promise<Response>,
  { signal, maxWaitMs = 10_000 }: { signal?: AbortSignal; maxWaitMs?: number } = {},
): Promise<Response> {
  let first: Response;
  try {
    first = await send();
  } catch (err) {
    // Aborts and timeouts are deliberate; only a failed connection is worth another try.
    if (!(err instanceof TypeError)) throw err;
    await sleep(baseDelay(), signal);
    return send();
  }
  if (!RETRYABLE.has(first.status)) return first;

  const wait = retryAfterMs(first) ?? baseDelay();
  if (wait > maxWaitMs) return first;
  await first.body?.cancel();
  await sleep(wait, signal);
  return send();
}
