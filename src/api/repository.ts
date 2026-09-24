/**
 * Joins Shopify with both couriers into the app's order list.
 *
 * Shopify is the source of truth for what was sold; the courier is the source
 * of truth for where the parcel is. Which courier, and which AWB, comes from
 * the tracking entry OKA writes on the Shopify fulfillment ("J&T Express" or
 * "Bosta"). Orders booked but not yet fulfilled are still found on either
 * side by OKA's own references:
 *   - Bosta: `businessReference` = the Shopify order name ("#2623721")
 *   - J&T:   `txlogisticId`      = "SHOPIFY" + the order number
 */

import { parseActivity, type ActivityEntry } from './activity';
import { getDeliveryByTracking, searchDeliveries, type BostaDelivery } from './bosta';
import { bostaConfigured, jtConfigured } from './config';
import {
  orderNameForTxId,
  ordersForShopifyNames,
  shipmentFor,
  shipmentsFor,
  type JtShipment,
} from './jt';
import { buildOrder, carrierOfTracking, parcelFromShopify, pickParcel, type Order } from './model';
import { fetchCatalog, fetchOrderById, fetchOrderByName, fetchOrders, type CatalogProduct } from './shopify';
import type { ShopifyOrder } from './shopify';

/** Strip the leading "#" so every system's references compare equal. */
const refKey = (s: string | undefined | null): string =>
  (s ?? '').trim().replace(/^#/, '').toLowerCase();

// ─────────────────────────────────────────────────────────────────────────────
// Bosta
// ─────────────────────────────────────────────────────────────────────────────

/** Recent Bosta deliveries, keyed by the Shopify order name they reference. */
async function bostaIndex(pages: number): Promise<Map<string, BostaDelivery>> {
  const index = new Map<string, BostaDelivery>();
  if (!bostaConfigured) return index;
  const deliveries = await searchDeliveries({ limit: 100, maxPages: pages });
  for (const d of deliveries) {
    const key = refKey(d.businessReference);
    if (!key) continue;
    // Deliveries arrive newest-first; keep the first (latest) per reference.
    if (!index.has(key)) index.set(key, d);
  }
  return index;
}

async function bostaByName(name: string): Promise<BostaDelivery | null> {
  if (!bostaConfigured) return null;
  try {
    const found = await searchDeliveries({ search: name.replace(/^#/, ''), limit: 5, maxPages: 1 });
    return found.find((d) => refKey(d.businessReference) === refKey(name)) ?? null;
  } catch {
    // A missing shipment is a legitimate state (order not booked yet).
    return null;
  }
}

async function bostaByAwb(awb: string): Promise<BostaDelivery | null> {
  return bostaConfigured ? getDeliveryByTracking(awb) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// J&T
// ─────────────────────────────────────────────────────────────────────────────

type Warn = (courier: 'Bosta' | 'J&T', err: unknown) => void;
const ignore: Warn = () => undefined;

/** J&T parcels booked under these orders' SHOPIFY<n> references, keyed by order. */
async function jtByNames(names: string[], warn: Warn = ignore): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!jtConfigured || names.length === 0) return out;
  try {
    const orders = await ordersForShopifyNames(names);
    // Newest booking wins when an order was booked more than once.
    orders.sort((a, b) => (b.createOrderTime ?? '').localeCompare(a.createOrderTime ?? ''));
    for (const o of orders) {
      const name = orderNameForTxId(o.txlogisticId);
      if (name && !out.has(refKey(name))) out.set(refKey(name), o.billCode);
    }
  } catch (err) {
    // Unreachable J&T must not take the order list down with it.
    warn('J&T', err);
  }
  return out;
}

async function jtShipments(billCodes: string[], warn: Warn = ignore): Promise<Map<string, JtShipment>> {
  try {
    return await shipmentsFor(billCodes);
  } catch (err) {
    warn('J&T', err);
    return new Map();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Joined list
// ─────────────────────────────────────────────────────────────────────────────

export type LoadResult = {
  orders: Order[];
  /** Orders with no courier shipment yet. */
  unshipped: number;
  /** Couriers that could not be read this time, e.g. "J&T: HTTP 0". */
  warnings: string[];
};

export async function loadOrders(opts: {
  ar: boolean;
  limit?: number;
  bostaPages?: number;
}): Promise<LoadResult> {
  const warnings = new Set<string>();
  const warn: Warn = (courier, err) =>
    warnings.add(`${courier}: ${err instanceof Error ? err.message : String(err)}`);

  const [shopifyOrders, index] = await Promise.all([
    fetchOrders(opts.limit ?? 50),
    bostaIndex(opts.bostaPages ?? 3).catch((err) => {
      warn('Bosta', err);
      return new Map<string, BostaDelivery>();
    }),
  ]);

  const hints = new Map(shopifyOrders.map((o) => [o.id, parcelFromShopify(o)]));

  // Orders Shopify doesn't yet show as shipped may still be booked with J&T.
  const unhinted = shopifyOrders.filter((o) => !hints.get(o.id) && !index.has(refKey(o.name)));
  const jtBooked = await jtByNames(unhinted.map((o) => o.name), warn);

  const jtCodes = [
    ...shopifyOrders.map((o) => hints.get(o.id)).filter((h) => h?.carrier === 'jt').map((h) => h!.awb),
    ...jtBooked.values(),
  ];
  const [jtByCode] = await Promise.all([
    jtShipments(jtCodes, warn),
    backfillBosta(shopifyOrders, hints, index, jtBooked),
  ]);

  const orders = shopifyOrders.map((o) => {
    const hint = hints.get(o.id) ?? null;
    const jtCode = hint?.carrier === 'jt' ? hint.awb : jtBooked.get(refKey(o.name));
    const parcel = pickParcel({
      hint,
      bosta: bostaFor(o, hint, index),
      jt: jtCode ? (jtByCode.get(jtCode) ?? null) : null,
    });
    return buildOrder(o, parcel, parseActivity(o), opts.ar);
  });

  return {
    orders,
    unshipped: orders.filter((o) => o.awb === null).length,
    warnings: [...warnings],
  };
}

function bostaFor(
  o: ShopifyOrder,
  hint: { carrier: string; awb: string } | null,
  index: Map<string, BostaDelivery>,
): BostaDelivery | null {
  if (hint?.carrier === 'bosta') return index.get(`awb:${hint.awb}`) ?? index.get(refKey(o.name)) ?? null;
  return index.get(refKey(o.name)) ?? null;
}

/**
 * Chase down Bosta shipments that fell outside the recent window: by AWB for
 * orders Shopify says went with Bosta, by name for orders on no courier yet.
 */
async function backfillBosta(
  orders: ShopifyOrder[],
  hints: Map<string, { carrier: string; awb: string } | null>,
  index: Map<string, BostaDelivery>,
  jtBooked: Map<string, string>,
  cap = 12,
): Promise<void> {
  if (!bostaConfigured) return;
  const jobs: (() => Promise<void>)[] = [];
  for (const o of orders) {
    const hint = hints.get(o.id);
    const known = index.get(refKey(o.name));
    if (hint?.carrier === 'bosta' && known?.trackingNumber !== hint.awb) {
      jobs.push(async () => {
        const d = await bostaByAwb(hint.awb);
        if (d) index.set(`awb:${hint.awb}`, d);
      });
    } else if (!hint && !known && !jtBooked.has(refKey(o.name))) {
      jobs.push(async () => {
        const d = await bostaByName(o.name);
        if (d) index.set(refKey(o.name), d);
      });
    }
  }
  await Promise.all(jobs.slice(0, cap).map((j) => j().catch(() => undefined)));
}

/** Everything about one order's parcel, looked up from scratch. */
async function parcelForOrder(order: ShopifyOrder) {
  const hint = parcelFromShopify(order);
  if (hint?.carrier === 'jt') {
    return pickParcel({ hint, bosta: null, jt: await shipmentFor(hint.awb).catch(() => null) });
  }
  if (hint?.carrier === 'bosta') {
    const d = (await bostaByAwb(hint.awb).catch(() => null)) ?? (await bostaByName(order.name));
    return pickParcel({ hint, bosta: d, jt: null });
  }
  const [bosta, booked] = await Promise.all([bostaByName(order.name), jtByNames([order.name])]);
  const code = booked.get(refKey(order.name));
  const jt = code ? await shipmentFor(code).catch(() => null) : null;
  return pickParcel({ hint: null, bosta, jt });
}

/** Re-read a single order after a write, so the UI shows what was stored. */
export async function reloadOrder(shopifyId: string, ar: boolean): Promise<Order | null> {
  const fresh = await fetchOrderById(shopifyId);
  if (!fresh) return null;
  return buildOrder(fresh, await parcelForOrder(fresh), parseActivity(fresh), ar);
}

/** A J&T AWB ("JEG000534521595"), as opposed to Bosta's all-digit numbers. */
const isJtAwb = (code: string) => /^JEG\d{6,}$/i.test(code);

/**
 * Resolve a scanned barcode to an order. A scan can be a J&T AWB, a Bosta
 * AWB, or a Shopify order name.
 */
export async function resolveScan(code: string, orders: Order[], ar: boolean): Promise<Order | null> {
  const raw = code.trim();
  const upper = raw.toUpperCase();
  const digits = raw.replace(/\D/g, '');

  // Fast path: already loaded.
  const local = orders.find(
    (o) =>
      (o.awb && (o.awb.toUpperCase() === upper || (o.carrier === 'bosta' && o.awb === digits))) ||
      refKey(o.name) === refKey(raw) ||
      refKey(o.name) === refKey(digits),
  );
  if (local) return local;

  // A J&T label: the parcel names its Shopify order in txlogisticId.
  if (isJtAwb(upper) && jtConfigured) {
    const shipment = await shipmentFor(upper).catch(() => null);
    const name = orderNameForTxId(shipment?.order?.txlogisticId);
    const order = name ? await fetchOrderByName(name) : null;
    if (order) return buildOrder(order, await parcelForOrder(order), parseActivity(order), ar);
  }

  // A Bosta label: the delivery names its order in businessReference.
  if (!isJtAwb(upper) && digits.length >= 6 && carrierOfTracking(null, digits) === 'bosta') {
    const delivery = await bostaByAwb(digits).catch(() => null);
    const ref = refKey(delivery?.businessReference);
    if (delivery && ref) {
      const order = await fetchOrderByName(ref);
      if (order) return buildOrder(order, await parcelForOrder(order), parseActivity(order), ar);
    }
  }

  // Or treat the code as a Shopify order name.
  const order = await fetchOrderByName(raw);
  if (order) return buildOrder(order, await parcelForOrder(order), parseActivity(order), ar);

  return null;
}

/** Phone search for the shipping-status screen — matches Shopify and both couriers. */
export function searchByPhone(orders: Order[], query: string): Order[] {
  const digits = query.replace(/\D/g, '');
  if (!digits) return orders;
  return orders.filter(
    (o) =>
      o.phone.replace(/\D/g, '').includes(digits) ||
      (o.awb ?? '').includes(digits) ||
      o.name.replace(/\D/g, '').includes(digits),
  );
}

/** Free-text search for the order list. */
export function searchOrders(orders: Order[], query: string): Order[] {
  const q = query.trim().toLowerCase();
  if (!q) return orders;
  const digits = q.replace(/\D/g, '');
  return orders.filter(
    (o) =>
      o.name.toLowerCase().includes(q) ||
      o.customerName.toLowerCase().includes(q) ||
      o.city.toLowerCase().includes(q) ||
      (o.awb ?? '').toLowerCase().includes(q) ||
      o.carrierName.toLowerCase().includes(q) ||
      (digits.length > 0 &&
        ((o.awb ?? '').includes(digits) || o.phone.replace(/\D/g, '').includes(digits))),
  );
}

export type { CatalogProduct };
export { fetchCatalog };
export type { ActivityEntry };
