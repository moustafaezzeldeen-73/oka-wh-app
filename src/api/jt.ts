import { CONFIG, jtConfigured, usingProxy } from './config';
import { ApiError, fetchJson } from './http';
import {
  cancelPayload,
  signedRequest,
  sortScans,
  txIdForOrder,
  updatePayload,
  type JtEnvelope,
  type JtOrder,
  type JtShipment,
  type JtTrace,
} from './jtState';

// Types and mapping live in jtState.ts (no native deps); re-exported here so
// callers have a single J&T entry point.
export * from './jtState';

/**
 * J&T Express Egypt Open Platform client.
 * Docs: https://open.jtjms-eg.com/#/apiDoc/index
 *
 * Every call is a form POST of one `bizContent` JSON field, signed in the
 * headers (see jtState.signedRequest). J&T answers HTTP 200 even on failure;
 * `code: "1"` is the only success.
 *
 * There is no "list my shipments" call this account may use (the date-range
 * query is permission-gated), so shipments are always looked up by AWB or by
 * OKA's own reference, SHOPIFY<order number>.
 */

/** Batch sizes: trace documents 30; order queries are kept conservative. */
const TRACE_BATCH = 30;
const ORDER_BATCH = 20;

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

async function call<T>(path: string, bizContent: Record<string, unknown>, withAuth: boolean): Promise<T> {
  let url: string;
  let init: RequestInit;
  if (usingProxy) {
    // The proxy holds the keys and signs; it gets the bare business content.
    url = `${CONFIG.proxyUrl}/jt${path}`;
    init = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bizContent, withAuth }),
    };
  } else {
    const req = signedRequest(CONFIG.jt, bizContent, withAuth, Date.now());
    url = `${CONFIG.jt.baseUrl}${path}`;
    init = { method: 'POST', headers: req.headers, body: req.body };
  }
  const res = await fetchJson<JtEnvelope<T>>(url, init, usingProxy ? 'proxy' : 'jt');
  if (res?.code !== '1') {
    throw new ApiError('jt', 200, `J&T ${res?.code ?? '?'}: ${res?.msg ?? 'unknown error'}`);
  }
  return res.data as T;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

/** Scan history for any number of AWBs. */
export async function traceMany(billCodes: string[]): Promise<Map<string, JtTrace>> {
  const out = new Map<string, JtTrace>();
  const unique = Array.from(new Set(billCodes.filter(Boolean)));
  await Promise.all(
    chunks(unique, TRACE_BATCH).map(async (batch) => {
      const data = await call<JtTrace[]>('/api/logistics/trace', { billCodes: batch.join(',') }, false);
      for (const t of data ?? []) if (t?.billCode) out.set(t.billCode, t);
    }),
  );
  return out;
}

/** Order records by AWB (command 2) or by OKA's reference (command 1). */
async function ordersBy(command: 1 | 2, serials: string[]): Promise<JtOrder[]> {
  const unique = Array.from(new Set(serials.filter(Boolean)));
  const results = await Promise.all(
    chunks(unique, ORDER_BATCH).map((batch) =>
      call<JtOrder[]>('/api/order/getOrders', { command, serialNumber: batch }, true),
    ),
  );
  return results.flat().filter((o): o is JtOrder => !!o?.billCode);
}

export const ordersByBillCodes = (codes: string[]) => ordersBy(2, codes);

/** J&T parcels booked for these Shopify orders, keyed by the order name. */
export async function ordersForShopifyNames(names: string[]): Promise<JtOrder[]> {
  return ordersBy(1, names.map(txIdForOrder));
}

/**
 * Order records plus scan history for a set of AWBs. A failure in either half
 * degrades to what the other half returned rather than losing both.
 */
export async function shipmentsFor(billCodes: string[]): Promise<Map<string, JtShipment>> {
  const out = new Map<string, JtShipment>();
  if (!jtConfigured || billCodes.length === 0) return out;
  const [ordersRes, tracesRes] = await Promise.allSettled([
    ordersByBillCodes(billCodes),
    traceMany(billCodes),
  ]);
  if (ordersRes.status === 'rejected' && tracesRes.status === 'rejected') throw ordersRes.reason;
  const orders = ordersRes.status === 'fulfilled' ? ordersRes.value : [];
  const traces = tracesRes.status === 'fulfilled' ? tracesRes.value : new Map<string, JtTrace>();
  const byCode = new Map(orders.map((o) => [o.billCode, o]));
  for (const code of new Set(billCodes)) {
    const order = byCode.get(code) ?? null;
    const trace = traces.get(code);
    if (!order && !trace) continue;
    out.set(code, {
      billCode: code,
      order,
      scans: sortScans(trace?.details),
      dispatches: typeof trace?.numberOfDispatch === 'number' ? trace.numberOfDispatch : null,
    });
  }
  return out;
}

export async function shipmentFor(billCode: string): Promise<JtShipment | null> {
  return (await shipmentsFor([billCode])).get(billCode) ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Writes — only accepted before J&T picks the parcel up
// ─────────────────────────────────────────────────────────────────────────────

export async function cancelJtOrder(order: JtOrder, reason: string): Promise<void> {
  await call('/api/order/cancelOrder', cancelPayload(order, reason), true);
}

/**
 * Change COD and/or the street line. J&T has no edit call: the order is
 * resubmitted in full with operateType 2 and the same txlogisticId.
 */
export async function updateJtOrder(
  order: JtOrder,
  orderName: string,
  change: { cod?: number; street?: string; pickInfo?: string },
): Promise<void> {
  await call('/api/order/addOrder', updatePayload(order, orderName, change), true);
}
