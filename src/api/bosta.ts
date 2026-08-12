import type { BostaDelivery } from './bostaState';
import { CONFIG, usingProxy } from './config';
import { fetchJson } from './http';

// Types and state mapping live in bostaState.ts (no native deps); re-exported
// here so callers have a single Bosta entry point.
export * from './bostaState';

/**
 * Bosta v2 client.
 *
 * Auth is the raw API key in the `Authorization` header — no `Bearer` prefix.
 * Two production quirks are handled here rather than at the call sites:
 *   1. `/deliveries/search` ignores its date filters, so date narrowing is done
 *      locally over descending pages.
 *   2. Responses wrap the payload in `{ success, message, data }` — but not
 *      always, so `unwrap` tolerates both shapes.
 */

type BostaEnvelope<T> = { success?: boolean; message?: string; data?: T } & Partial<T>;

function url(path: string): string {
  if (usingProxy) return `${CONFIG.proxyUrl}/bosta${path}`;
  return `${CONFIG.bosta.baseUrl}${path}`;
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (!usingProxy) h.Authorization = CONFIG.bosta.apiKey;
  return h;
}

function unwrap<T>(res: BostaEnvelope<T>): T {
  return (res?.data ?? res) as T;
}

async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetchJson<BostaEnvelope<T>>(
    url(path),
    {
      method,
      headers: headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    usingProxy ? 'proxy' : 'bosta',
  );
  return unwrap<T>(res);
}

// ─────────────────────────────────────────────────────────────────────────────
// Calls
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Page through `/deliveries/search`. `createdAfter` is applied client-side
 * because Bosta's own date filter returns unfiltered results.
 */
export async function searchDeliveries(opts: {
  search?: string;
  state?: string;
  limit?: number;
  maxPages?: number;
  createdAfter?: Date;
}): Promise<BostaDelivery[]> {
  const limit = opts.limit ?? 100;
  const maxPages = opts.maxPages ?? 5;
  const out: BostaDelivery[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const body: Record<string, unknown> = {
      limit,
      pageId: page,
      pageNumber: page,
      page,
    };
    if (opts.state) body.state = opts.state;
    if (opts.search) body.search = opts.search;

    const data = await request<{ deliveries?: BostaDelivery[]; list?: BostaDelivery[] }>(
      'POST',
      '/deliveries/search',
      body,
    );
    const batch = data?.deliveries ?? data?.list ?? [];
    if (!Array.isArray(batch) || batch.length === 0) break;

    let reachedEnd = false;
    for (const d of batch) {
      if (opts.createdAfter && d.createdAt) {
        const created = new Date(d.createdAt);
        // Results come newest-first, so the first older row ends the sweep.
        if (!Number.isNaN(created.getTime()) && created < opts.createdAfter) {
          reachedEnd = true;
          break;
        }
      }
      out.push(d);
    }

    if (reachedEnd || batch.length < limit) break;
  }

  return out;
}

export async function getDeliveryByTracking(trackingNumber: string): Promise<BostaDelivery | null> {
  try {
    return await request<BostaDelivery>('GET', `/deliveries/business/${trackingNumber}`);
  } catch {
    return null;
  }
}

export async function getDeliveryById(id: string): Promise<BostaDelivery | null> {
  try {
    return await request<BostaDelivery>('GET', `/deliveries/${id}`);
  } catch {
    return null;
  }
}

/**
 * Full tracking detail for one AWB.
 *
 * Note `/deliveries/track/{awb}` — the public tracking route — 404s on the v2
 * business API, so the timeline comes from the single-delivery endpoint, whose
 * response carries a `timeline` array plus a verbose `log`.
 */
export async function fetchTracking(trackingNumber: string): Promise<BostaDelivery | null> {
  return getDeliveryByTracking(trackingNumber);
}

export async function updateDeliveryCod(deliveryId: string, cod: number): Promise<void> {
  await request('PUT', `/deliveries/business/${deliveryId}`, { cod });
}

export async function updateDelivery(
  deliveryId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await request('PUT', `/deliveries/business/${deliveryId}`, payload);
}

export async function cancelDelivery(deliveryId: string): Promise<void> {
  await request('DELETE', `/deliveries/${deliveryId}/terminate`);
}
