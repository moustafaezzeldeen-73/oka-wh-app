/**
 * Bosta domain types and the pure mappings from Bosta's state vocabulary onto
 * the app's five-phase tracking model.
 *
 * Deliberately free of network and native dependencies so the mapping rules can
 * be exercised directly (see scripts/test-logic.ts).
 */

export type BostaAddress = {
  city?: { _id: string; name: string; nameAr?: string };
  zone?: { _id: string; name: string; nameAr?: string };
  district?: { _id: string; name: string; nameAr?: string };
  firstLine?: string;
  secondLine?: string;
  buildingNumber?: string;
  floor?: string;
  apartment?: string;
  addressClarityScore?: number;
  isBadAddress?: boolean;
  geoLocation?: number[];
};

export type BostaDelivery = {
  _id: string;
  trackingNumber: string;
  /** Shopify order name, e.g. "#2623721" — the join key. */
  businessReference?: string;
  cod: number;
  type?: { code: number; value: string };
  state: {
    value: string;
    code: number;
    childState?: unknown;
    deliveryTime?: string | null;
    pickedUpTime?: string;
    returnedToBusiness?: string;
    /** Every failed attempt, newest last, with the courier's reason. */
    exception?: BostaException[];
  };
  receiver?: {
    _id?: string;
    phone?: string;
    firstName?: string;
    lastName?: string;
    fullName?: string;
    secondPhone?: string | null;
    /** Bosta's own delivery-success score for this customer, 0–100. */
    ranking?: number;
  };
  sender?: { _id?: string; name?: string; phone?: string; type?: string };
  /** Whoever physically holds the parcel: hub staff, the courier (role STAR), then the customer. */
  holder?: { _id?: string; name?: string; phone?: string; role?: string };
  /** The courier ("star") assigned to deliver or return the parcel. */
  star?: { _id?: string; name?: string; phone?: string };
  dropOffAddress?: BostaAddress;
  pickupAddress?: BostaAddress;
  specs?: {
    size?: string;
    weight?: number;
    packageType?: string;
    packageDetails?: { itemsCount?: number; description?: string };
  };
  /** Bosta's own five-phase progress, present on the single-delivery endpoint. */
  timeline?: BostaTimelineEntry[];
  /** Coarse status Bosta shows the consignee, e.g. "in Transit". */
  maskedState?: string;
  createdAt?: string;
  updatedAt?: string;
  scheduledAt?: string;
  callsNumber?: number;
  smsNumber?: number;
  attemptsCount?: number;
  numberOfAttempts?: number;
  isDelayed?: boolean;
  collectedFromBusiness?: string;
  pendingPickup?: string;
  latestAWBPrintDate?: string;
  notes?: string;
  /** Bosta's shipping fee before VAT — only on the single-delivery endpoint. */
  shipmentFees?: number;
  /** COD as booked; `cod` drops to 0 once a parcel is returned. Single-delivery endpoint only. */
  originalCod?: number;
  /** Settlement for this parcel — single-delivery endpoint only. */
  wallet?: BostaWallet;
};

/** One failed attempt. `attemptType: "return"` is the trip back to OKA, not a customer failure. */
export type BostaException = {
  reason?: string;
  code?: number;
  time?: string;
  attemptType?: string;
};

/** Amounts are strings ("86.64"); `deposited_amt` is what reached OKA's balance (COD − fees). */
export type BostaWallet = {
  cashCycle?: {
    cod?: string;
    bosta_fees?: string;
    shipping_fees?: string;
    vat?: string;
    deposited_amt?: number;
    deposited_at?: string;
  } | null;
  cashout?: { amount?: string; transaction_date?: string; transaction_id?: string } | null;
};

export type BostaTrackEvent = {
  state?: string;
  value?: string;
  timestamp?: string;
  time?: string;
  reason?: string;
  hub?: string;
  exceptionReason?: string;
};

export type BostaTracking = {
  TrackingNumber?: string;
  CurrentStatus?: { state?: string; timestamp?: string };
  TransitEvents?: BostaTrackEvent[];
  provider?: string;
  CreateDate?: string;
  PromisedDate?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// State mapping
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Phase timestamps, exactly as Bosta computes them.
 *
 * `GET /deliveries/business/{awb}` returns a five-entry `timeline` that lines up
 * one-to-one with the phases this app renders:
 *
 *   new(10) → picked_up(21) → in_transit(30) → out_for_delivery(41) → delivered(45)
 *
 * Note these `code` values belong to the *timeline* vocabulary, which is not the
 * same as `state.code` (where 24 is "Received at warehouse" and 30 is "In
 * transit between hubs"). Prefer the timeline whenever it is present — it is
 * Bosta's own reckoning, complete with `done` flags and dates.
 */
export type BostaTimelineEntry = {
  value: string;
  code: number;
  done: boolean;
  date?: string;
};

/**
 * Timeline entries by name. Bosta usually sends these five, but returned and
 * lost parcels carry extra ones ("out_for_return", "returned_to_origin",
 * "lost", "confirmed_lost") — seen live as a 6th entry, which counting by
 * position turned into phase 5 and a ticked "Delivered" step.
 */
const TIMELINE_SLOT: Record<string, number> = {
  new: 0,
  picked_up: 1,
  in_transit: 2,
  out_for_delivery: 3,
  delivered: 4,
};

/** Phase = the furthest of the five known steps Bosta has marked done. */
export function phaseFromTimeline(timeline: BostaTimelineEntry[] | undefined): number | null {
  if (!Array.isArray(timeline) || timeline.length === 0) return null;
  let phase: number | null = null;
  for (const entry of timeline) {
    const slot = TIMELINE_SLOT[(entry.value ?? '').toLowerCase()];
    if (slot === undefined) continue;
    if (phase === null) phase = 0;
    if (entry.done) phase = Math.max(phase, slot);
  }
  return phase;
}

/** Per-phase timestamps for the tracking UI, indexed 0–4; other entries are ignored. */
export function timesFromTimeline(
  timeline: BostaTimelineEntry[] | undefined,
): (string | null)[] {
  const out: (string | null)[] = [null, null, null, null, null];
  if (!Array.isArray(timeline)) return out;
  for (const entry of timeline) {
    const slot = TIMELINE_SLOT[(entry.value ?? '').toLowerCase()];
    if (slot !== undefined) out[slot] = entry.date ?? null;
  }
  return out;
}

/**
 * Fallback when no timeline is available: collapse Bosta's `state.code`
 * vocabulary onto the same five phases.
 *
 * Verified against live deliveries: 10 Pickup requested, 21 Picked up from
 * business, 24 Received at warehouse, 30 In transit between hubs,
 * 41 Out for delivery, 45 Delivered, 46+ returned / terminated / lost.
 */
export function phaseFromState(code: number | undefined, value?: string): number {
  const v = (value ?? '').toLowerCase();

  // Label wins when it is unambiguous — child states reuse numeric codes.
  if (v.includes('delivered')) return 4;
  if (v.includes('out for delivery') || v.includes('delivering')) return 3;

  if (code === undefined) return 0;
  if (code === 45) return 4;
  if (code === 41) return 3;
  if (code === 24 || code === 30 || v.includes('transit') || v.includes('warehouse')) return 2;
  if (code === 20 || code === 21 || v.includes('picked')) return 1;
  return 0;
}

/**
 * True once Bosta physically holds the parcel. Past this point Bosta refuses
 * COD and address edits, so the app locks the same fields rather than letting
 * a picker make a change that will silently fail.
 */
export function isLockedState(code: number | undefined): boolean {
  return (code ?? 0) >= 20;
}

/**
 * Final states: 46 Returned to business, 48 Terminated, 49 Canceled,
 * 60 Returned to stock, 100 Lost, 101 Damaged. Not "≥ 46": 47 Exception,
 * 102 Investigation, 103 Awaiting your action and 105 On hold are live
 * parcels — the failed attempts staff most need to act on.
 */
const BOSTA_FINAL = new Set([46, 48, 49, 60, 100, 101]);

/** Returned, terminated, cancelled or lost — the order is off the floor. */
export function isTerminalState(code: number | undefined, value?: string): boolean {
  const v = (value ?? '').toLowerCase();
  if (v.includes('delivered')) return false;
  return (
    BOSTA_FINAL.has(code ?? -1) ||
    v.includes('terminated') ||
    v.includes('cancelled') ||
    v.includes('canceled') ||
    v.includes('returned') ||
    v.includes('lost') ||
    v.includes('damaged')
  );
}

/** Type 20 "Return to Origin": the parcel is coming back to OKA, whatever its state says. */
export function isReturning(d: Pick<BostaDelivery, 'type'> | null | undefined): boolean {
  return d?.type?.code === 20 || /return to origin/i.test(d?.type?.value ?? '');
}

/** "AXF-J-Ahmed Mostafa Elsayed\t -E" → "Ahmed Mostafa Elsayed". */
function cleanStarName(name: string): string {
  return name
    .replace(/\s+/g, ' ')
    .replace(/^[A-Z]{2,4}(-[A-Z]{1,2})?-/, '')
    .replace(/\s+-[A-Z]{1,2}$/, '')
    .trim();
}

/**
 * The courier: Bosta's `star`. `holder` is the customer once delivered and
 * hub staff (no role) while the parcel sits at a hub, so it only counts when
 * its role says STAR.
 */
export function courierOf(d: BostaDelivery | null): { name: string; phone: string } | null {
  if (d?.star?.name) return { name: cleanStarName(d.star.name), phone: d.star.phone ?? '' };
  if (!d?.holder?.name) return null;
  const role = (d.holder.role ?? '').toUpperCase();
  if (!role.includes('STAR')) return null;
  return { name: d.holder.name, phone: d.holder.phone ?? '' };
}
