/**
 * Joins the two systems into the app's order list.
 *
 * Shopify is the source of truth for what was sold; Bosta is the source of
 * truth for where the parcel is. They are joined on Bosta's `businessReference`,
 * which OKA sets to the Shopify order name (e.g. "#2623721").
 */

import { parseActivity, type ActivityEntry } from './activity';
import { getDeliveryByTracking, searchDeliveries, type BostaDelivery } from './bosta';
import { buildOrder, type Order } from './model';
import { fetchCatalog, fetchOrderById, fetchOrders, type CatalogProduct } from './shopify';
import type { ShopifyOrder } from './shopify';

/** Strip the leading "#" so both systems' references compare equal. */
const refKey = (s: string | undefined | null): string =>
  (s ?? '').trim().replace(/^#/, '').toLowerCase();

/** Recent Bosta deliveries, keyed by the Shopify order name they reference. */
async function deliveryIndex(pages: number): Promise<Map<string, BostaDelivery>> {
  const deliveries = await searchDeliveries({ limit: 100, maxPages: pages });
  const index = new Map<string, BostaDelivery>();
  for (const d of deliveries) {
    const key = refKey(d.businessReference);
    if (!key) continue;
    // Deliveries arrive newest-first; keep the first (latest) per reference.
    if (!index.has(key)) index.set(key, d);
  }
  return index;
}

/** Chase down shipments that fell outside the recent window. */
async function backfill(
  missing: ShopifyOrder[],
  index: Map<string, BostaDelivery>,
  cap = 12,
): Promise<void> {
  const targets = missing.slice(0, cap);
  await Promise.all(
    targets.map(async (o) => {
      try {
        const found = await searchDeliveries({
          search: o.name.replace(/^#/, ''),
          limit: 5,
          maxPages: 1,
        });
        const match = found.find((d) => refKey(d.businessReference) === refKey(o.name));
        if (match) index.set(refKey(o.name), match);
      } catch {
        // A missing shipment is a legitimate state (order not booked yet).
      }
    }),
  );
}

export type LoadResult = {
  orders: Order[];
  /** Orders Shopify returned that have no Bosta shipment yet. */
  unshipped: number;
};

export async function loadOrders(opts: {
  ar: boolean;
  limit?: number;
  bostaPages?: number;
}): Promise<LoadResult> {
  const [shopifyOrders, index] = await Promise.all([
    fetchOrders(opts.limit ?? 50),
    deliveryIndex(opts.bostaPages ?? 3),
  ]);

  const missing = shopifyOrders.filter((o) => !index.has(refKey(o.name)));
  if (missing.length) await backfill(missing, index);

  const orders = shopifyOrders.map((o) =>
    buildOrder(o, index.get(refKey(o.name)) ?? null, parseActivity(o), opts.ar),
  );

  return {
    orders,
    unshipped: orders.filter((o) => o.awb === null).length,
  };
}

/** Re-read a single order after a write, so the UI shows what Shopify stored. */
export async function reloadOrder(
  shopifyId: string,
  ar: boolean,
  knownDelivery?: BostaDelivery | null,
): Promise<Order | null> {
  const fresh = await fetchOrderById(shopifyId);
  if (!fresh) return null;

  let delivery = knownDelivery ?? null;
  if (delivery === undefined || delivery === null) {
    const found = await searchDeliveries({
      search: fresh.name.replace(/^#/, ''),
      limit: 5,
      maxPages: 1,
    });
    delivery = found.find((d) => refKey(d.businessReference) === refKey(fresh.name)) ?? null;
  }

  return buildOrder(fresh, delivery, parseActivity(fresh), ar);
}

/**
 * Resolve a scanned barcode to an order.
 * A scan can be an AWB (Bosta tracking number) or a Shopify order name.
 */
export async function resolveScan(
  code: string,
  orders: Order[],
  ar: boolean,
): Promise<Order | null> {
  const raw = code.trim();
  const digits = raw.replace(/\D/g, '');

  // Fast path: already loaded.
  const local = orders.find(
    (o) =>
      (o.awb && o.awb === digits) ||
      refKey(o.name) === refKey(raw) ||
      refKey(o.name) === refKey(digits),
  );
  if (local) return local;

  // Otherwise ask Bosta, then pull the Shopify order it references.
  if (digits.length >= 6) {
    const delivery = await getDeliveryByTracking(digits);
    const ref = refKey(delivery?.businessReference);
    if (delivery && ref) {
      const { fetchOrderByName } = await import('./shopify');
      const order = await fetchOrderByName(ref);
      if (order) return buildOrder(order, delivery, parseActivity(order), ar);
    }
  }

  // Or treat the code as a Shopify order name.
  const { fetchOrderByName } = await import('./shopify');
  const order = await fetchOrderByName(raw);
  if (order) {
    const found = await searchDeliveries({
      search: order.name.replace(/^#/, ''),
      limit: 5,
      maxPages: 1,
    });
    const delivery = found.find((d) => refKey(d.businessReference) === refKey(order.name)) ?? null;
    return buildOrder(order, delivery, parseActivity(order), ar);
  }

  return null;
}

/** Phone search for the shipping-status screen — matches Shopify and Bosta. */
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
      (digits.length > 0 &&
        ((o.awb ?? '').includes(digits) || o.phone.replace(/\D/g, '').includes(digits))),
  );
}

export type { CatalogProduct };
export { fetchCatalog };
export type { ActivityEntry };
