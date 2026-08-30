export interface FetchWithRetryOptions {
  timeoutMs?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  headers?: Record<string, string>;
}

export type FetchResult =
  | { status: "OK"; response: Response }
  | { status: "TIMEOUT" }
  | { status: "RATE_LIMITED"; retryAfterMs: number | null }
  | { status: "ERROR"; error: string }
  | { status: "PROVIDER_UNAVAILABLE"; httpStatus: number };

/**
 * The single place every provider should route HTTP calls through —
 * consistent timeout, exponential backoff, and explicit rate-limit
 * detection (429 / Retry-After) rather than each provider reinventing it
 * (or worse, silently swallowing errors into a fabricated fallback).
 */
export async function fetchWithRetry(url: string, options: FetchWithRetryOptions = {}): Promise<FetchResult> {
  const { timeoutMs = 10000, maxRetries = 3, baseDelayMs = 500, headers } = options;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers, signal: controller.signal });
      clearTimeout(timer);

      if (res.status === 429) {
        const retryAfterHeader = res.headers.get("retry-after");
        const retryAfterMs = retryAfterHeader ? parseInt(retryAfterHeader, 10) * 1000 : null;
        if (attempt < maxRetries) {
          await sleep(retryAfterMs ?? baseDelayMs * 2 ** attempt);
          continue;
        }
        return { status: "RATE_LIMITED", retryAfterMs };
      }

      if (res.status >= 500) {
        if (attempt < maxRetries) {
          await sleep(baseDelayMs * 2 ** attempt);
          continue;
        }
        return { status: "PROVIDER_UNAVAILABLE", httpStatus: res.status };
      }

      return { status: "OK", response: res };
    } catch (err: unknown) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === "AbortError") {
        if (attempt < maxRetries) {
          await sleep(baseDelayMs * 2 ** attempt);
          continue;
        }
        return { status: "TIMEOUT" };
      }
      if (attempt < maxRetries) {
        await sleep(baseDelayMs * 2 ** attempt);
        continue;
      }
      return { status: "ERROR", error: err instanceof Error ? err.message : "Unknown fetch error" };
    }
  }
  return { status: "ERROR", error: "Exhausted retries" };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
