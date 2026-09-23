/**
 * Shared fetch helpers: timeouts, one retry on transient failure, and error
 * objects carrying enough context for the UI to show something actionable.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly body: string;
  readonly source: 'shopify' | 'bosta' | 'gemini' | 'proxy';

  constructor(source: ApiError['source'], status: number, message: string, body = '') {
    super(message);
    this.name = 'ApiError';
    this.source = source;
    this.status = status;
    this.body = body;
  }
}

const DEFAULT_TIMEOUT = 20_000;

export async function fetchJson<T>(
  url: string,
  init: RequestInit & { timeoutMs?: number },
  source: ApiError['source'],
): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT, ...rest } = init;

  let lastError: unknown;
  // Two attempts: warehouse Wi-Fi drops a request now and then, and a blind
  // retry is far cheaper than making the picker tap again.
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...rest, signal: controller.signal });
      clearTimeout(timer);

      const text = await res.text();
      if (!res.ok) {
        // 429/5xx are worth a second shot; 4xx are not.
        if ((res.status === 429 || res.status >= 500) && attempt === 0) {
          await delay(600);
          continue;
        }
        throw new ApiError(source, res.status, `${source} HTTP ${res.status}`, text.slice(0, 500));
      }
      return (text ? JSON.parse(text) : {}) as T;
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof ApiError) throw err;
      lastError = err;
      if (attempt === 0) {
        await delay(600);
        continue;
      }
    }
  }

  const msg = lastError instanceof Error ? lastError.message : 'network request failed';
  throw new ApiError(source, 0, msg);
}

export const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
