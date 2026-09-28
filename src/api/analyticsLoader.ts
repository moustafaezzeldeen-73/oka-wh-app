/**
 * Fetches everything the delivery report needs for a period, with the network
 * calls injected so the same code runs on the phone (src/api/analyticsSources.ts)
 * and in `npm run report` (scripts/report.mjs).
 *
 * Cost per period (≈40 orders a day):
 *   - Shopify: one bulk export. A paged query at ~13 cost points per order
 *     drains the rate-limit bucket in a few pages; the bulk export costs
 *     nothing against it and returns a month in seconds.
 *   - J&T: getWaybillInfo, 1000 AWBs per call; trace (30 per call) only for
 *     parcels not yet signed for; getOrders (20 per call) only for delivered
 *     ones, for the COD J&T actually collected.
 *   - Bosta: the search list (100 per page, newest first — its date filter is
 *     ignored) and, per finished parcel, the single-delivery endpoint for the
 *     fees (~70 KB each, so capped and cached).
 */

import {
  bostaOutcome,
  emptyCourierData,
  factFor,
  summarize,
  type AnalyticsOrder,
  type AnalyticsReport,
  type CourierData,
  type JtWaybill,
  type ShipmentFact,
} from './analytics';
import type { BostaDelivery } from './bostaState';
import type { JtOrder, JtTrace } from './jtState';
import { parcelFromShopify } from './model';

export type AnalyticsSources = {
  /** Shopify Admin GraphQL: resolves to `data`, throws on errors. */
  shopify: <T>(query: string, variables?: Record<string, unknown>) => Promise<T>;
  /** Plain GET of a URL as text — the bulk export file. */
  download: (url: string) => Promise<string>;
  /** J&T call resolving to `data`; `withAuth` adds customerCode + business digest. */
  jt: {
    customerCode: string;
    call: <T>(path: string, bizContent: Record<string, unknown>, withAuth: boolean) => Promise<T>;
  } | null;
  /** Bosta call resolving to the unwrapped `data`. */
  bosta: (<T>(method: 'GET' | 'POST', path: string, body?: unknown) => Promise<T>) | null;
};

export type LoadStep = 'shopify' | 'jt' | 'bosta';
export type LoadProgress = (step: LoadStep, done?: number, total?: number) => void;

export type AnalyticsResult = {
  report: AnalyticsReport;
  facts: ShipmentFact[];
  /** Couriers or steps that could not be read, e.g. "J&T trace: HTTP 0". */
  warnings: string[];
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/** Run `fn` over `items` with at most `limit` in flight. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ─────────────────────────────────────────────────────────────────────────────
// Shopify: bulk export of the period's orders
// ─────────────────────────────────────────────────────────────────────────────

/** Only fields `read_orders` covers — one missing scope would fail the whole export. */
export const EXPORT_FIELDS = `
  id name tags createdAt cancelledAt displayFinancialStatus paymentGatewayNames
  currentTotalPriceSet { shopMoney { amount } }
  totalReceivedSet { shopMoney { amount } }
  totalRefundedSet { shopMoney { amount } }
  totalOutstandingSet { shopMoney { amount } }
  fulfillments { status createdAt trackingInfo { company number } }
  shippingAddress { city province provinceCode }
  deliveryCost: metafield(namespace: "oka", key: "delivery_cost") { value }
`;

/**
 * Shopify's search needs full timestamps: a bare date in `created_at:<2026-09-20`
 * is compared by day in the shop's zone and let 20 September's orders through.
 */
export function ordersSearch(from: Date, to: Date): string {
  return `created_at:>='${from.toISOString()}' AND created_at:<'${to.toISOString()}'`;
}

export function exportQuery(from: Date, to: Date): string {
  return `{ orders(query: ${JSON.stringify(ordersSearch(from, to))}, sortKey: CREATED_AT) { edges { node { ${EXPORT_FIELDS} } } } }`;
}

const RUN_EXPORT = `mutation RunAnalyticsExport($q: String!) {
  bulkOperationRunQuery(query: $q) {
    bulkOperation { id status }
    userErrors { field message code }
  }
}`;

const EXPORT_STATUS = `query ExportStatus($id: ID!) {
  node(id: $id) {
    ... on BulkOperation { id status errorCode objectCount url partialDataUrl }
  }
}`;

type BulkOp = {
  id: string;
  status: string;
  errorCode: string | null;
  objectCount: string;
  url: string | null;
  partialDataUrl: string | null;
};

/** One JSON object per line; blank lines skipped. */
export function parseJsonl<T>(text: string): T[] {
  const out: T[] = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t) out.push(JSON.parse(t) as T);
  }
  return out;
}

export async function exportOrders(
  src: AnalyticsSources,
  from: Date,
  to: Date,
  opts: { wait?: (ms: number) => Promise<void>; timeoutMs?: number } = {},
): Promise<AnalyticsOrder[]> {
  const wait = opts.wait ?? sleep;
  const run = await src.shopify<{
    bulkOperationRunQuery: {
      bulkOperation: { id: string; status: string } | null;
      userErrors: { message: string; code?: string | null }[];
    };
  }>(RUN_EXPORT, { q: exportQuery(from, to) });
  const errs = run.bulkOperationRunQuery.userErrors ?? [];
  const op = run.bulkOperationRunQuery.bulkOperation;
  if (errs.length || !op) {
    throw new Error(`Shopify export: ${errs.map((e) => e.message).join('; ') || 'not started'}`);
  }

  const deadline = Date.now() + (opts.timeoutMs ?? 180_000);
  let delay = 700;
  for (;;) {
    const res = await src.shopify<{ node: BulkOp | null }>(EXPORT_STATUS, { id: op.id });
    const n = res.node;
    if (n?.status === 'COMPLETED') {
      // A period with no orders completes with no file at all.
      if (!n.url) return [];
      const rows = parseJsonl<AnalyticsOrder & { __parentId?: string }>(await src.download(n.url));
      const fromMs = from.getTime();
      const toMs = to.getTime();
      return rows.filter((o) => {
        if (o.__parentId) return false;
        const t = new Date(o.createdAt).getTime();
        return t >= fromMs && t < toMs;
      });
    }
    if (n && ['FAILED', 'CANCELED', 'CANCELLED', 'EXPIRED'].includes(n.status)) {
      throw new Error(`Shopify export ${n.status.toLowerCase()}${n.errorCode ? ` (${n.errorCode})` : ''}`);
    }
    if (Date.now() > deadline) throw new Error('Shopify export is taking too long — try a shorter period');
    await wait(delay);
    delay = Math.min(delay * 1.5, 3000);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// J&T
// ─────────────────────────────────────────────────────────────────────────────

/** J&T's "nothing matched" comes back as this error rather than an empty list. */
const isNoResults = (e: unknown) => /999001030/.test(errText(e));

async function readJt(
  src: NonNullable<AnalyticsSources['jt']>,
  awbs: string[],
  data: CourierData,
  warn: (m: string) => void,
  progress: LoadProgress,
): Promise<void> {
  const unique = [...new Set(awbs)];
  const waybillBatches = chunks(unique, 1000);
  let waybillFailures = 0;
  for (const batch of waybillBatches) {
    try {
      const rows = await src.call<JtWaybill[]>(
        '/api/waybill/getWaybillInfo',
        { customerCode: src.customerCode, waybillNos: batch },
        false,
      );
      for (const w of rows ?? []) if (w?.waybillNo) data.jt.waybills.set(w.waybillNo, w);
    } catch (e) {
      if (!isNoResults(e)) {
        waybillFailures++;
        warn(`J&T waybills: ${errText(e)}`);
      }
    }
  }
  data.jt.read = waybillFailures < waybillBatches.length;
  if (!data.jt.read) return;

  // Scans only matter for parcels not signed for yet: returns in progress, problems.
  const toTrace = unique.filter((a) => data.jt.waybills.get(a)?.isSign !== 1);
  const toPrice = unique.filter((a) => data.jt.waybills.get(a)?.isSign === 1);
  const traceBatches = chunks(toTrace, 30);
  const orderBatches = chunks(toPrice, 20);
  const total = traceBatches.length + orderBatches.length;
  let done = 0;
  progress('jt', done, total);

  await mapLimit(traceBatches, 3, async (batch) => {
    try {
      const traces = await src.call<JtTrace[]>('/api/logistics/trace', { billCodes: batch.join(',') }, false);
      for (const t of traces ?? []) if (t?.billCode) data.jt.scans.set(t.billCode, t.details ?? []);
    } catch (e) {
      if (!isNoResults(e)) warn(`J&T tracking: ${errText(e)}`);
    }
    progress('jt', ++done, total);
  });

  await mapLimit(orderBatches, 3, async (batch) => {
    try {
      const orders = await src.call<JtOrder[]>('/api/order/getOrders', { command: 2, serialNumber: batch }, true);
      for (const o of orders ?? []) if (o?.billCode) data.jt.orders.set(o.billCode, o);
    } catch (e) {
      if (!isNoResults(e)) warn(`J&T orders: ${errText(e)}`);
    }
    progress('jt', ++done, total);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Bosta
// ─────────────────────────────────────────────────────────────────────────────

async function readBosta(
  call: NonNullable<AnalyticsSources['bosta']>,
  awbs: string[],
  from: Date,
  data: CourierData,
  warn: (m: string) => void,
  progress: LoadProgress,
  opts: { detailCap: number; cache?: Map<string, BostaDelivery> },
): Promise<void> {
  const wanted = new Set(awbs);
  const found = data.bosta.deliveries;

  // 1. The search list, newest first, until it is older than the period (with slack
  //    for parcels booked a few days after the order).
  const stopAt = from.getTime() - 5 * 86_400_000;
  try {
    for (let page = 1; page <= 30; page++) {
      const res = await call<{ deliveries?: BostaDelivery[]; list?: BostaDelivery[] }>('POST', '/deliveries/search', {
        limit: 100,
        pageId: page,
        pageNumber: page,
        page,
      });
      const batch = res?.deliveries ?? res?.list ?? [];
      if (!Array.isArray(batch) || batch.length === 0) break;
      let older = false;
      for (const d of batch) {
        if (wanted.has(d.trackingNumber)) found.set(d.trackingNumber, d);
        const t = new Date(d.createdAt ?? '').getTime();
        if (Number.isFinite(t) && t < stopAt) older = true;
      }
      progress('bosta');
      if (older || batch.length < 100 || [...wanted].every((a) => found.has(a))) break;
    }
    data.bosta.read = true;
  } catch (e) {
    warn(`Bosta: ${errText(e)}`);
  }

  // 2. The single-delivery endpoint: parcels the list missed, and fees for
  //    finished parcels (the list carries no fees).
  const needDetail = [...wanted].filter((awb) => {
    const cached = opts.cache?.get(awb);
    if (cached) {
      found.set(awb, cached);
      return false;
    }
    const d = found.get(awb);
    if (!d) return true;
    const outcome = bostaOutcome(d);
    return (outcome === 'delivered' || outcome === 'failed') && d.wallet === undefined && d.shipmentFees === undefined;
  });
  const capped = needDetail.slice(0, opts.detailCap);
  if (needDetail.length > capped.length) {
    warn(`Bosta fees read for ${capped.length} of ${needDetail.length} parcels; the rest use the average`);
  }
  let done = 0;
  progress('bosta', done, capped.length);
  await mapLimit(capped, 4, async (awb) => {
    try {
      const d = await call<BostaDelivery>('GET', `/deliveries/business/${awb}`);
      if (d?.trackingNumber) {
        found.set(awb, d);
        data.bosta.read = true;
        const outcome = bostaOutcome(d);
        // Only finished parcels are cached: their fees won't change.
        if (outcome === 'delivered' || outcome === 'failed') opts.cache?.set(awb, d);
      }
    } catch (e) {
      warn(`Bosta ${awb}: ${errText(e)}`);
    }
    progress('bosta', ++done, capped.length);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Everything
// ─────────────────────────────────────────────────────────────────────────────

export async function loadAnalytics(
  src: AnalyticsSources,
  opts: {
    from: Date;
    to: Date;
    onProgress?: LoadProgress;
    /** Max Bosta single-delivery reads per load (fees). */
    bostaDetailCap?: number;
    /** Finished Bosta parcels already read, keyed by AWB; filled as it goes. */
    bostaCache?: Map<string, BostaDelivery>;
    wait?: (ms: number) => Promise<void>;
  },
): Promise<AnalyticsResult> {
  const progress: LoadProgress = opts.onProgress ?? (() => undefined);
  const warnings: string[] = [];
  const warn = (m: string) => {
    if (!warnings.includes(m)) warnings.push(m);
  };

  progress('shopify');
  const orders = await exportOrders(src, opts.from, opts.to, { wait: opts.wait });

  const jtAwbs: string[] = [];
  const bostaAwbs: string[] = [];
  for (const o of orders) {
    const p = parcelFromShopify({
      fulfillments: (o.fulfillments ?? []).map((f) => ({
        status: f.status,
        createdAt: f.createdAt,
        trackingInfo: (f.trackingInfo ?? []).map((t) => ({ company: t.company, number: t.number, url: null })),
      })),
    });
    if (p?.carrier === 'jt') jtAwbs.push(p.awb);
    if (p?.carrier === 'bosta') bostaAwbs.push(p.awb);
  }

  const data = emptyCourierData();
  if (jtAwbs.length) {
    progress('jt');
    if (src.jt) await readJt(src.jt, jtAwbs, data, warn, progress);
    else warn('J&T keys are not set — J&T parcels are counted as unknown');
  }
  if (bostaAwbs.length) {
    progress('bosta');
    if (src.bosta) {
      await readBosta(src.bosta, bostaAwbs, opts.from, data, warn, progress, {
        detailCap: opts.bostaDetailCap ?? 120,
        cache: opts.bostaCache,
      });
    } else {
      warn('Bosta key is not set — Bosta parcels are counted as unknown');
    }
  }

  const facts = orders.map((o) => factFor(o, data));
  const report = summarize(facts, { from: opts.from.toISOString(), to: opts.to.toISOString() });
  return { report, facts, warnings };
}
