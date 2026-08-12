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
import type { ShopifyLineItem, ShopifyOrder } from './shopify';
import type { ActivityEntry } from './activityLog';

/** One row in the order's contents list. */
export type OrderItem = {
  lineItemId: string;
  variantId: string | null;
  title: string;
  quantity: number;
  unitPrice: number;
  sku: string;
  image: string | null;
};

/** The single order shape every screen renders from. */
export type Order = {
  // identity
  shopifyId: string;
  /** Shopify order name, e.g. "#2623721". */
  name: string;
  /** Bosta tracking number (AWB), or null when no shipment exists yet. */
  awb: string | null;
  bostaId: string | null;
  carrier: string;

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

  // scoring, straight from Bosta
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
  /** Per-phase timestamps from Bosta's timeline, indexed 0–4. */
  phaseTimes: (string | null)[];

  // contents
  items: OrderItem[];
  itemCount: number;
  thumb: string | null;

  // app-managed
  activity: ActivityEntry[];
  tags: string[];
  note: string | null;
  createdAt: string;
  /** True once Bosta has the parcel: quantities and address are frozen. */
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
  return {
    lineItemId: li.id,
    variantId: li.variant?.id ?? null,
    title: li.title,
    quantity: li.quantity,
    unitPrice: num(li.originalUnitPriceSet?.shopMoney?.amount ?? li.variant?.price),
    sku: li.sku ?? '',
    image: li.image?.url ?? li.variant?.image?.url ?? null,
  };
}

function addressFrom(order: ShopifyOrder, delivery: BostaDelivery | null, ar: boolean): string {
  const drop = delivery?.dropOffAddress;
  if (drop?.firstLine) {
    const parts = [
      drop.firstLine,
      drop.secondLine,
      drop.buildingNumber ? `عمارة ${drop.buildingNumber}` : '',
      drop.floor ? `الدور ${drop.floor}` : '',
      drop.apartment ? `شقة ${drop.apartment}` : '',
    ].filter(Boolean);
    return parts.join('، ');
  }
  const sa = order.shippingAddress;
  const parts = [sa?.address1, sa?.address2, ar ? '' : sa?.city].filter(Boolean);
  return parts.join(', ') || (sa?.city ?? '—');
}

function cityFrom(order: ShopifyOrder, delivery: BostaDelivery | null, ar: boolean): string {
  const c = delivery?.dropOffAddress?.city;
  if (c) return (ar ? c.nameAr || c.name : c.name) ?? '';
  return order.shippingAddress?.city ?? order.shippingAddress?.province ?? '—';
}

/**
 * Chip status, resolved from the two systems in priority order:
 * cancelled → shipment state → address quality → local "ready" tag → new.
 */
function statusFrom(
  order: ShopifyOrder,
  delivery: BostaDelivery | null,
  phase: number,
): ChipKey {
  if (order.cancelledAt) return 'cancelled';
  if (delivery && isTerminalState(delivery.state?.code, delivery.state?.value)) return 'cancelled';
  if (phase >= 4) return 'delivered';
  if (phase >= 2) return 'transit';
  if (phase === 1) return 'picked';
  if (delivery?.dropOffAddress?.isBadAddress) return 'badaddr';
  if ((delivery?.dropOffAddress?.addressClarityScore ?? 100) < 40) return 'badaddr';
  if (order.tags.some((t) => t.toLowerCase() === 'oka-ready')) return 'ready';
  if (delivery) return 'ready';
  return 'new';
}

/** Fuse one Shopify order with its Bosta shipment into the render model. */
export function buildOrder(
  order: ShopifyOrder,
  delivery: BostaDelivery | null,
  activity: ActivityEntry[],
  ar: boolean,
): Order {
  // Bosta's own timeline is authoritative when present; the state-code mapping
  // is only a fallback for list payloads, which omit it.
  const phase = delivery
    ? (phaseFromTimeline(delivery.timeline) ??
      phaseFromState(delivery.state?.code, delivery.state?.value))
    : 0;
  const items = order.lineItems.nodes.map(itemFrom);
  const customerName =
    order.shippingAddress?.name ??
    order.customer?.displayName ??
    delivery?.receiver?.fullName ??
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
    '';

  return {
    shopifyId: order.id,
    name: order.name,
    awb: delivery?.trackingNumber ?? null,
    bostaId: delivery?._id ?? null,
    carrier: 'Bosta',

    customerName,
    phone: normalizePhone(phone),
    city: cityFrom(order, delivery, ar),
    address: addressFrom(order, delivery, ar),
    initials: initialsOf(order.customer?.displayName ?? customerName),

    cod: delivery?.cod ?? num(order.currentTotalPriceSet?.shopMoney?.amount),
    subtotal: num(order.currentSubtotalPriceSet?.shopMoney?.amount),
    shipping: num(order.totalShippingPriceSet?.shopMoney?.amount),
    currency: order.currentTotalPriceSet?.shopMoney?.currencyCode ?? 'EGP',

    rank: delivery?.receiver?.ranking ?? null,
    clarity: delivery?.dropOffAddress?.addressClarityScore ?? null,
    badAddress: delivery?.dropOffAddress?.isBadAddress ?? false,

    status: statusFrom(order, delivery, phase),
    stateValue: delivery?.state?.value ?? 'Not shipped',
    stateCode: delivery?.state?.code ?? null,
    trackPhase: phase,
    trackPhaseLabel: PHASES[phase] ?? PHASES[0],
    courier: courierOf(delivery),
    attempts: delivery?.attemptsCount ?? delivery?.numberOfAttempts ?? 0,
    scheduledAt: delivery?.scheduledAt ?? null,
    phaseTimes: timesFromTimeline(delivery?.timeline),

    items,
    itemCount: items.reduce((s, i) => s + i.quantity, 0),
    thumb: hero?.image ?? null,

    activity,
    tags: order.tags,
    note: order.note,
    createdAt: order.createdAt,
    locked: delivery ? isLockedState(delivery.state?.code) : false,
  };
}

/** Egyptian numbers to E.164, so Shopify/Bosta/WhatsApp all agree. */
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
