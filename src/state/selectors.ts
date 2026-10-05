import { CARRIER_NAME, type CarrierKey, type Order } from '../api/model';
import type { FilterKey, Strings } from '../i18n/strings';

export type CallStatus = 'notcalled' | 'notanswered' | 'answered';

/** Derived from the order's own activity log, so it survives app restarts. */
export function callStatus(order: Order): CallStatus {
  const calls = order.activity.filter((e) => e.kind === 'call');
  if (calls.length === 0) return 'notcalled';
  const last = calls[calls.length - 1];
  return last.outcome === 'answered' ? 'answered' : 'notanswered';
}

export function applyFilter(orders: Order[], key: FilterKey): Order[] {
  switch (key) {
    case 'all':
      return orders;
    case 'ready':
      return orders.filter((o) => o.status === 'ready');
    case 'badaddr':
      return orders.filter((o) => o.status === 'badaddr' || o.badAddress);
    case 'cancelled':
      return orders.filter((o) => o.status === 'cancelled');
    case 'readypickup':
      return orders.filter((o) => o.tags.some((t) => t.toLowerCase() === 'oka-ready'));
    case 'bosta':
    case 'jt':
    case 'inhouse':
      return orders.filter((o) => o.carrier === key);
    case 'notcalled':
    case 'notanswered':
    case 'answered':
      return orders.filter((o) => callStatus(o) === key);
    default:
      return orders;
  }
}

export type OrderPhoto = {
  /** Null while Shopify is still processing the upload. */
  url: string | null;
  at: string | null;
  /** Shopify File id, when known. */
  fileId: string | null;
};

/**
 * Photos attached to the order, oldest first: every photo entry in the log,
 * plus any file in the order's Warehouse photos field the log doesn't link.
 */
export function orderPhotos(order: Order): OrderPhoto[] {
  const out: OrderPhoto[] = [];
  const seen = new Set<string>();
  for (const e of order.activity) {
    if (e.kind !== 'photo') continue;
    const fileId = typeof e.meta?.fileId === 'string' ? e.meta.fileId : null;
    if (!e.mediaUrl && !fileId) continue;
    const key = fileId ?? e.mediaUrl!;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ url: e.mediaUrl ?? null, at: e.at, fileId });
  }
  for (const id of order.photoIds) {
    if (!seen.has(id)) out.push({ url: null, at: null, fileId: id });
  }
  return out;
}

/** Call + WhatsApp entries, newest first, for the contact-history list. */
export function contactHistory(order: Order) {
  return order.activity
    .filter((e) => e.kind === 'call' || e.kind === 'whatsapp')
    .slice()
    .reverse();
}

/**
 * Why a scanned order can't go on this truck, or null when it can. Courier
 * trucks take only their own AWBs. The in-house truck takes orders without a
 * courier, and J&T or Bosta parcels rerouted to OKA's own delivery under the
 * same AWB (see `isRerouted`) — but only while that courier hasn't picked the
 * parcel up. When the courier's status couldn't be read, it refuses rather
 * than guess.
 */
export function truckRefusal(
  order: Order,
  truck: CarrierKey,
  L: Pick<Strings, 'wrongTruck' | 'noAwbForTruck' | 'inhouse' | 'pickedUpByCourier' | 'courierUnknown'>,
): string | null {
  if (truck === 'inhouse') {
    if (order.carrier !== 'jt' && order.carrier !== 'bosta') return null;
    const fill = (t: string) => t.replace('{order}', order.name).replace('{carrier}', order.carrierName);
    const known = order.carrier === 'jt' ? order.jtOrder !== null : order.bostaId !== null;
    if (!known) return fill(L.courierUnknown);
    if (order.locked || order.trackPhase >= 1) return fill(L.pickedUpByCourier);
    return null;
  }
  if (order.carrier === truck) return null;
  const truckName = CARRIER_NAME[truck];
  if (order.carrier) {
    return L.wrongTruck
      .replace('{order}', order.name)
      .replace('{carrier}', order.carrierName)
      .replace('{truck}', truckName);
  }
  return L.noAwbForTruck.replace('{order}', order.name).replace('{truck}', truckName);
}

/**
 * A J&T or Bosta parcel going out on the in-house truck: rerouted with its
 * courier AWB. Only noted on the Shopify order — its courier stays as it is.
 */
export function isRerouted(order: Order, truck: CarrierKey): boolean {
  return truck === 'inhouse' && (order.carrier === 'jt' || order.carrier === 'bosta');
}
