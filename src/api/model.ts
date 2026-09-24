import type { ChipKey } from '../theme/tokens';
import { PHASES } from '../i18n/strings';
import {
  courierOf,
  isLockedState,
  isTerminalState,
  phaseFromState,
  phaseFromTimeline,
  timesFromTimeline,
  type BostaDelivery,
} from './bostaState';
import {
  jtAttempts,
  jtCourier,
  jtEvents,
  jtIsLocked,
  jtIsTerminal,
  jtOpenProblem,
  jtPhase,
  jtPhaseTimes,
  jtStateLabel,
  jtTimeToIso,
  type JtEvent,
  type JtOrder,
  type JtProblem,
  type JtShipment,
} from './jtState';
import type { ShopifyLineItem, ShopifyOrder } from './shopify';
import type { ActivityEntry } from './activityLog';

// ─────────────────────────────────────────────────────────────────────────────
// Couriers
// ─────────────────────────────────────────────────────────────────────────────

export type CarrierKey = 'bosta' | 'jt' | 'inhouse';

export const CARRIER_NAME: Record<CarrierKey, string> = {
  bosta: 'Bosta',
  jt: 'J&T Express',
  inhouse: 'In-house delivery',
};

/** Set when an order goes out on OKA's own truck (truck loading, In-house). */
export const TAG_INHOUSE = 'oka-inhouse';
/** Set when an in-house delivery is marked delivered. */
export const TAG_DELIVERED = 'oka-delivered';

const hasTag = (order: Pick<ShopifyOrder, 'tags'>, tag: string) =>
  order.tags.some((t) => t.toLowerCase() === tag);

/** File ids in the order's `oka.photos` field (a JSON list of Shopify File ids). */
export function photoIdsOf(order: Pick<ShopifyOrder, 'photos'>): string[] {
  try {
    const ids = JSON.parse(order.photos?.value ?? '[]');
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * One order's parcel, from whichever outside courier carries it (in-house
 * deliveries have no AWB and are read from the order's own tags and log). `delivery` /
 * `shipment` is null when the AWB is known (from Shopify) but the courier's
 * API could not be read — no keys, or offline.
 */
export type Parcel =
  | { carrier: 'bosta'; awb: string; delivery: BostaDelivery | null }
  | { carrier: 'jt'; awb: string; shipment: JtShipment | null };

export const bostaParcel = (d: BostaDelivery): Parcel => ({
  carrier: 'bosta',
  awb: d.trackingNumber,
  delivery: d,
});

export const jtParcel = (s: JtShipment): Parcel => ({ carrier: 'jt', awb: s.billCode, shipment: s });

/** Courier named on a Shopify tracking entry — by company, else by AWB shape. */
export function carrierOfTracking(company: string | null, number: string | null): CarrierKey | null {
  const c = (company ?? '').toLowerCase();
  if (/j\s*&\s*t|j\s*and\s*t|\bjnt\b/.test(c)) return 'jt';
  if (c.includes('bosta')) return 'bosta';
  const n = (number ?? '').trim();
  if (/^JEG\d+$/i.test(n)) return 'jt';
  if (/^\d{6,12}$/.test(n)) return 'bosta';
  return null;
}

/**
 * The parcel OKA recorded on the Shopify order when it was fulfilled: the
 * newest live fulfillment's tracking number and courier.
 */
export function parcelFromShopify(order: ShopifyOrder): { carrier: CarrierKey; awb: string } | null {
  const live = (order.fulfillments ?? [])
    .filter((f) => !/cancel|error|fail/i.test(f.status ?? ''))
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  for (const f of live) {
    for (const t of f.trackingInfo ?? []) {
      const carrier = carrierOfTracking(t.company, t.number);
      if (carrier && t.number) return { carrier, awb: t.number.trim() };
    }
  }
  return null;
}

function createdMs(p: Parcel): number {
  const raw =
    p.carrier === 'bosta'
      ? p.delivery?.createdAt
      : (jtTimeToIso(p.shipment?.order?.createOrderTime) ?? undefined);
  const t = raw ? new Date(raw).getTime() : NaN;
  return Number.isFinite(t) ? t : 0;
}

function parcelIsTerminal(p: Parcel): boolean {
  if (p.carrier === 'bosta') return !!p.delivery && isTerminalState(p.delivery.state?.code, p.delivery.state?.value);
  return !!p.shipment && jtIsTerminal(p.shipment);
}

/**
 * Which parcel an order is on. The courier recorded on the Shopify
 * fulfillment wins; otherwise any shipment either courier holds for the
 * order, live ones before cancelled or returned, newest first.
 */
export function pickParcel(opts: {
  hint: { carrier: CarrierKey; awb: string } | null;
  bosta: BostaDelivery | null;
  jt: JtShipment | null;
}): Parcel | null {
  const { hint, bosta, jt } = opts;
  if (hint?.carrier === 'jt') {
    return { carrier: 'jt', awb: hint.awb, shipment: jt?.billCode === hint.awb ? jt : null };
  }
  if (hint?.carrier === 'bosta') {
    return { carrier: 'bosta', awb: hint.awb, delivery: bosta?.trackingNumber === hint.awb ? bosta : null };
  }
  const found: Parcel[] = [];
  if (bosta) found.push(bostaParcel(bosta));
  if (jt) found.push(jtParcel(jt));
  found.sort(
    (a, b) =>
      Number(parcelIsTerminal(a)) - Number(parcelIsTerminal(b)) || createdMs(b) - createdMs(a),
  );
  return found[0] ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Render model
// ─────────────────────────────────────────────────────────────────────────────

/** One row in the order's contents list. */
export type OrderItem = {
  lineItemId: string;
  variantId: string | null;
  title: string;
  quantity: number;
  unitPrice: number;
  /** After every discount — what goes on a courier's invoice. */
  netUnitPrice: number;
  sku: string;
  image: string | null;
};

/** The single order shape every screen renders from. */
export type Order = {
  // identity
  shopifyId: string;
  /** Shopify order name, e.g. "#2623721". */
  name: string;
  /** Courier tracking number (AWB), or null when no shipment exists yet. */
  awb: string | null;
  carrier: CarrierKey | null;
  /** "Bosta" / "J&T Express", or '' before a courier is booked. */
  carrierName: string;
  bostaId: string | null;
  /** J&T's record of the parcel; needed to cancel or resubmit it. */
  jtOrder: JtOrder | null;

  // customer
  customerName: string;
  phone: string;
  city: string;
  address: string;
  initials: string;

  // money (EGP)
  cod: number;
  subtotal: number;
  shipping: number;
  currency: string;

  // scoring, straight from Bosta (J&T has no equivalent)
  rank: number | null;
  clarity: number | null;
  badAddress: boolean;

  // shipment
  status: ChipKey;
  stateValue: string;
  stateCode: number | null;
  trackPhase: number;
  trackPhaseLabel: { ar: string; en: string };
  courier: { name: string; phone: string } | null;
  attempts: number;
  scheduledAt: string | null;
  /** Per-phase timestamps from the courier, indexed 0–4. */
  phaseTimes: (string | null)[];
  /** An unresolved delivery problem the courier reported (J&T). */
  problem: JtProblem | null;
  /** Scan-by-scan history, newest first (J&T). */
  events: JtEvent[];
  /** In-house deliveries: what the delivery cost, once marked delivered. */
  deliveryCost: number | null;
  /** Shopify File ids of the warehouse photos (`oka.photos`). */
  photoIds: string[];
  /**
   * The courier will collect a different amount than the customer owes on
   * Shopify. Only raised while the parcel is still on its way.
   */
  codMismatch: { courier: number; shopify: number } | null;

  // contents
  items: OrderItem[];
  itemCount: number;
  thumb: string | null;

  // app-managed
  activity: ActivityEntry[];
  tags: string[];
  note: string | null;
  createdAt: string;
  /** True once the courier has the parcel: quantities and address are frozen. */
  locked: boolean;
};

const num = (s: string | number | null | undefined): number => {
  const n = typeof s === 'number' ? s : parseFloat(s ?? '0');
  return Number.isFinite(n) ? n : 0;
};

function initialsOf(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .map((p) => p[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase() || '—'
  );
}

function itemFrom(li: ShopifyLineItem): OrderItem {
  const unitPrice = num(li.originalUnitPriceSet?.shopMoney?.amount ?? li.variant?.price);
  const net = li.discountedUnitPriceAfterAllDiscountsSet?.shopMoney?.amount;
  return {
    lineItemId: li.id,
    variantId: li.variant?.id ?? null,
    title: li.title,
    // Order edits lower currentQuantity; quantity keeps the original count.
    quantity: li.currentQuantity ?? li.quantity,
    unitPrice,
    netUnitPrice: net === undefined ? unitPrice : num(net),
    sku: li.sku ?? '',
    image: li.image?.url ?? li.variant?.image?.url ?? null,
  };
}

/** Current line items — edits applied, removed lines dropped. */
export function itemsOf(order: ShopifyOrder): OrderItem[] {
  return order.lineItems.nodes.map(itemFrom).filter((i) => i.quantity > 0);
}

/**
 * The contents line printed on a courier's AWB, e.g. "OKA Carbon Black x1;
 * Tongs x2" — rebuilt after an order edit so the label matches the box.
 */
export function packageDescription(items: Pick<OrderItem, 'title' | 'quantity'>[], max = 250): string {
  const text = items
    .filter((i) => i.quantity > 0)
    .map((i) => `${i.title} x${i.quantity}`)
    .join('; ');
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** What the customer still owes on the Shopify order: the cash to collect. */
export function shopifyCodOf(order: ShopifyOrder): number {
  const owed = order.totalOutstandingSet?.shopMoney?.amount;
  return num(owed ?? order.currentTotalPriceSet?.shopMoney?.amount);
}

function shopifyAddress(order: ShopifyOrder, ar: boolean): string {
  const sa = order.shippingAddress;
  const parts = [sa?.address1, sa?.address2, ar ? '' : sa?.city].filter(Boolean);
  return parts.join(', ') || (sa?.city ?? '—');
}

function bostaAddress(delivery: BostaDelivery | null): string | null {
  const drop = delivery?.dropOffAddress;
  if (!drop?.firstLine) return null;
  return [
    drop.firstLine,
    drop.secondLine,
    drop.buildingNumber ? `عمارة ${drop.buildingNumber}` : '',
    drop.floor ? `الدور ${drop.floor}` : '',
    drop.apartment ? `شقة ${drop.apartment}` : '',
  ]
    .filter(Boolean)
    .join('، ');
}

function jtAddress(order: JtOrder | null): string | null {
  const r = order?.receiver;
  if (!r?.street) return null;
  // The street line usually repeats the area; only add the area when it doesn't.
  return r.area && !r.street.includes(r.area) ? `${r.street}، ${r.area}` : r.street;
}

function bostaCity(delivery: BostaDelivery | null, ar: boolean): string | null {
  const c = delivery?.dropOffAddress?.city;
  return c ? ((ar ? c.nameAr || c.name : c.name) ?? null) : null;
}

/** What J&T and the app both need to know about a parcel, courier-neutral. */
type Tracking = {
  phase: number;
  times: (string | null)[];
  terminal: boolean;
  locked: boolean;
  courier: { name: string; phone: string } | null;
  attempts: number;
  stateValue: string;
  stateCode: number | null;
  problem: JtProblem | null;
  events: JtEvent[];
};

const NO_TRACKING: Tracking = {
  phase: 0,
  times: [null, null, null, null, null],
  terminal: false,
  locked: false,
  courier: null,
  attempts: 0,
  stateValue: 'Not shipped',
  stateCode: null,
  problem: null,
  events: [],
};

function bostaTracking(d: BostaDelivery): Tracking {
  // Bosta's own timeline is authoritative when present; the state-code mapping
  // is only a fallback for list payloads, which omit it.
  const phase = phaseFromTimeline(d.timeline) ?? phaseFromState(d.state?.code, d.state?.value);
  return {
    phase,
    times: timesFromTimeline(d.timeline),
    terminal: isTerminalState(d.state?.code, d.state?.value),
    locked: isLockedState(d.state?.code),
    courier: courierOf(d),
    attempts: d.attemptsCount ?? d.numberOfAttempts ?? 0,
    stateValue: d.state?.value ?? 'Created',
    stateCode: d.state?.code ?? null,
    problem: null,
    events: [],
  };
}

function jtTracking(s: JtShipment): Tracking {
  return {
    phase: jtPhase(s),
    times: jtPhaseTimes(s),
    terminal: jtIsTerminal(s),
    locked: jtIsLocked(s),
    courier: jtCourier(s),
    attempts: jtAttempts(s),
    stateValue: jtStateLabel(s),
    stateCode: s.scans[0]?.scanTypeCode ?? s.order?.orderStatus ?? null,
    problem: jtOpenProblem(s),
    events: jtEvents(s),
  };
}

/**
 * In-house deliveries: loaded (truck loading, In-house) counts as out for
 * delivery; "Mark delivered" finishes it. Times come from the order's log.
 */
function inhouseTracking(order: ShopifyOrder, activity: ActivityEntry[]): Tracking {
  const newestFirst = activity.slice().reverse();
  const loaded = newestFirst.find((e) => e.kind === 'scan' && e.meta?.carrier === 'inhouse');
  const delivered = newestFirst.find((e) => e.kind === 'status' && e.meta?.delivered === true);
  const done = hasTag(order, TAG_DELIVERED) || delivered !== undefined;
  const loadedAt = loaded?.at ?? null;
  return {
    ...NO_TRACKING,
    phase: done ? 4 : 3,
    times: [order.createdAt, loadedAt, loadedAt, loadedAt, delivered?.at ?? null],
    locked: done,
    stateValue: done ? 'Delivered (in-house)' : 'Out for delivery (in-house)',
  };
}

function trackingOf(parcel: Parcel | null): Tracking {
  if (parcel?.carrier === 'bosta' && parcel.delivery) return bostaTracking(parcel.delivery);
  if (parcel?.carrier === 'jt' && parcel.shipment) return jtTracking(parcel.shipment);
  if (parcel) return { ...NO_TRACKING, stateValue: 'Booked' };
  return NO_TRACKING;
}

/**
 * Chip status, resolved in priority order:
 * cancelled → shipment progress → address quality → local "ready" tag → new.
 */
function statusFrom(
  order: ShopifyOrder,
  parcel: Parcel | null,
  t: Tracking,
  delivery: BostaDelivery | null,
): ChipKey {
  if (order.cancelledAt) return 'cancelled';
  if (t.terminal) return 'cancelled';
  if (t.phase >= 4) return 'delivered';
  if (t.phase >= 2) return 'transit';
  if (t.phase === 1) return 'picked';
  if (delivery?.dropOffAddress?.isBadAddress) return 'badaddr';
  if ((delivery?.dropOffAddress?.addressClarityScore ?? 100) < 40) return 'badaddr';
  if (order.tags.some((t) => t.toLowerCase() === 'oka-ready')) return 'ready';
  if (parcel) return 'ready';
  return 'new';
}

/** Fuse one Shopify order with its courier shipment into the render model. */
export function buildOrder(
  order: ShopifyOrder,
  parcel: Parcel | null,
  activity: ActivityEntry[],
  ar: boolean,
): Order {
  const delivery = parcel?.carrier === 'bosta' ? parcel.delivery : null;
  const jt = parcel?.carrier === 'jt' ? (parcel.shipment?.order ?? null) : null;
  // An outside courier's parcel wins; otherwise the in-house tag decides.
  const inhouse = !parcel && hasTag(order, TAG_INHOUSE);
  const t = inhouse ? inhouseTracking(order, activity) : trackingOf(parcel);
  const carrier: CarrierKey | null = parcel?.carrier ?? (inhouse ? 'inhouse' : null);

  const items = itemsOf(order);
  const customerName =
    order.shippingAddress?.name ??
    order.customer?.displayName ??
    delivery?.receiver?.fullName ??
    jt?.receiver?.name ??
    '—';

  // The thumbnail is the highest-value line — the item that identifies the box.
  const hero = items.reduce<OrderItem | null>(
    (a, b) => (a === null || b.unitPrice * b.quantity > a.unitPrice * a.quantity ? b : a),
    null,
  );

  const phone =
    order.shippingAddress?.phone ??
    order.customer?.phone ??
    delivery?.receiver?.phone ??
    jt?.receiver?.mobile?.replace(/^\+20-/, '') ??
    '';

  const courierCod = delivery?.cod ?? jt?.itemsValue;
  const shopifyCod = shopifyCodOf(order);

  const shopifyCity = order.shippingAddress?.city ?? order.shippingAddress?.province ?? null;
  const city =
    bostaCity(delivery, ar) ??
    // J&T keeps whatever language OKA booked in — usually Arabic.
    (ar ? (jt?.receiver?.city ?? shopifyCity) : (shopifyCity ?? jt?.receiver?.city)) ??
    '—';

  return {
    shopifyId: order.id,
    name: order.name,
    awb: parcel?.awb ?? null,
    carrier,
    carrierName: carrier ? CARRIER_NAME[carrier] : '',
    bostaId: delivery?._id ?? null,
    jtOrder: jt,

    customerName,
    phone: normalizePhone(phone),
    city,
    address: bostaAddress(delivery) ?? jtAddress(jt) ?? shopifyAddress(order, ar),
    initials: initialsOf(order.customer?.displayName ?? customerName),

    cod: courierCod ?? shopifyCod,
    subtotal: num(order.currentSubtotalPriceSet?.shopMoney?.amount),
    shipping: num(order.totalShippingPriceSet?.shopMoney?.amount),
    currency: order.currentTotalPriceSet?.shopMoney?.currencyCode ?? 'EGP',

    rank: delivery?.receiver?.ranking ?? null,
    clarity: delivery?.dropOffAddress?.addressClarityScore ?? null,
    badAddress: delivery?.dropOffAddress?.isBadAddress ?? false,

    status: statusFrom(order, parcel, t, delivery),
    stateValue: t.stateValue,
    stateCode: t.stateCode,
    trackPhase: t.phase,
    trackPhaseLabel: PHASES[t.phase] ?? PHASES[0],
    courier: t.courier,
    attempts: t.attempts,
    scheduledAt: delivery?.scheduledAt ?? null,
    phaseTimes: t.times,
    problem: t.problem,
    events: t.events,
    deliveryCost: order.deliveryCost?.value ? num(order.deliveryCost.value) : null,
    photoIds: photoIdsOf(order),
    codMismatch:
      courierCod !== undefined &&
      Math.round(courierCod) !== Math.round(shopifyCod) &&
      !order.cancelledAt &&
      !t.terminal &&
      t.phase < 4
        ? { courier: courierCod, shopify: shopifyCod }
        : null,

    items,
    itemCount: items.reduce((s, i) => s + i.quantity, 0),
    thumb: hero?.image ?? null,

    activity,
    tags: order.tags,
    note: order.note,
    createdAt: order.createdAt,
    locked: t.locked,
  };
}

/** Egyptian numbers to E.164, so Shopify, the couriers and WhatsApp all agree. */
export function normalizePhone(raw: string): string {
  const digits = (raw ?? '').replace(/[^\d+]/g, '');
  if (!digits) return '';
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  if (digits.startsWith('20')) return `+${digits}`;
  if (digits.startsWith('0')) return `+20${digits.slice(1)}`;
  if (digits.length === 10) return `+20${digits}`;
  return `+${digits}`;
}

/** WhatsApp wants the number with no leading plus. */
export const waNumber = (phone: string): string => normalizePhone(phone).replace(/^\+/, '');

export const money = (n: number): string =>
  Math.round(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
