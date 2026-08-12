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
  state: { value: string; code: number; childState?: unknown; deliveryTime?: string | null };
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
  /** Whoever physically holds the parcel — the courier once it's assigned. */
  holder?: { _id?: string; name?: string; phone?: string; role?: string };
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

/** Phase index = the last entry Bosta has marked done. */
export function phaseFromTimeline(timeline: BostaTimelineEntry[] | undefined): number | null {
  if (!Array.isArray(timeline) || timeline.length === 0) return null;
  let phase = 0;
  timeline.forEach((entry, i) => {
    if (entry.done) phase = i;
  });
  return phase;
}

/** Per-phase timestamps for the tracking UI, indexed 0–4. */
export function timesFromTimeline(
  timeline: BostaTimelineEntry[] | undefined,
): (string | null)[] {
  const out: (string | null)[] = [null, null, null, null, null];
  if (!Array.isArray(timeline)) return out;
  timeline.slice(0, 5).forEach((entry, i) => {
    out[i] = entry.date ?? null;
  });
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

/** Returned, terminated, cancelled or lost — the order is off the floor. */
export function isTerminalState(code: number | undefined, value?: string): boolean {
  const v = (value ?? '').toLowerCase();
  if (v.includes('delivered')) return false;
  return (
    (code ?? 0) >= 46 ||
    v.includes('terminated') ||
    v.includes('cancelled') ||
    v.includes('returned') ||
    v.includes('lost')
  );
}

/** The business account holds the parcel until a courier is assigned. */
export function courierOf(d: BostaDelivery | null): { name: string; phone: string } | null {
  if (!d?.holder?.name) return null;
  const role = (d.holder.role ?? '').toUpperCase();
  if (role.includes('BUSINESS')) return null;
  if (d.sender?._id && d.holder._id === d.sender._id) return null;
  return { name: d.holder.name, phone: d.holder.phone ?? '' };
}
