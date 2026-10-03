/**
 * J&T Express Egypt: domain types, request signing, and the pure mapping from
 * J&T's scan vocabulary onto the app's five-phase tracking model.
 *
 * Free of network and native imports so the rules can be exercised directly —
 * scripts/test-logic.ts runs them against live J&T responses.
 */

import { md5, toBase64, toHex } from './md5';

// ─────────────────────────────────────────────────────────────────────────────
// Types, as returned by /api/order/getOrders and /api/logistics/trace
// ─────────────────────────────────────────────────────────────────────────────

export type JtParty = {
  name?: string;
  /** Stored by J&T as "+20-01025843317" even when sent as "01025843317". */
  mobile?: string;
  phone?: string;
  countryCode?: string;
  prov?: string;
  city?: string;
  area?: string;
  street?: string;
  building?: string;
  floor?: string;
  flats?: string;
  company?: string;
  postCode?: string;
};

export type JtOrder = {
  /** OKA's own reference: "SHOPIFY" + the Shopify order number. */
  txlogisticId: string;
  /** The AWB, e.g. "JEG000534521595". */
  billCode: string;
  customerId?: string;
  expressType?: string;
  orderType?: string;
  serviceType?: string;
  deliveryType?: string;
  payType?: string;
  goodsType?: string;
  weight?: number;
  totalQuantity?: number;
  /** Cash to collect on delivery. */
  itemsValue?: number;
  priceCurrency?: string;
  remark?: string;
  pickInfo?: string;
  sender?: JtParty;
  receiver?: JtParty;
  /** Cairo wall-clock time, "2026-09-23T08:36:02". */
  createOrderTime?: string;
  updateOrderTime?: string;
  sortingCode?: string;
  /** 100 unassigned, 101 assigned to branch, 102 assigned to courier, 103 picked up, 104 cancelled. */
  orderStatus?: number;
  lastCenterName?: string;
};

export type JtScan = {
  /** Cairo wall-clock time, "2026-09-22 13:42:44". */
  scanTime: string;
  desc?: string;
  scanType?: string;
  scanTypeCode?: number;
  scanNetworkName?: string;
  scanNetworkProvince?: string;
  scanNetworkCity?: string;
  scanNetworkArea?: string;
  nextStopName?: string;
  problemType?: string;
  problemReason?: string;
  /** Sic — J&T's spelling. "Abnormal parcelScan,1004,<reason>,<courier note>". */
  probleDescription?: string;
  /** Comma-separated photo URLs taken when the problem was registered. */
  problemPicUrl?: string;
  sigPicUrl?: string;
  electronicSignaturePicUrl?: string;
  otp?: string;
  staffName?: string;
  staffContact?: string;
};

export type JtTrace = { billCode: string; details?: JtScan[]; numberOfDispatch?: number };

/** One J&T parcel: the order record plus its scan history, newest scan first. */
export type JtShipment = {
  billCode: string;
  order: JtOrder | null;
  scans: JtScan[];
  dispatches: number | null;
};

export type JtEnvelope<T> = { code?: string | number; msg?: string; data?: T };

// ─────────────────────────────────────────────────────────────────────────────
// Request signing
// ─────────────────────────────────────────────────────────────────────────────

export type JtCredentials = {
  apiAccount: string;
  privateKey: string;
  customerCode: string;
  customerPassword: string;
};

/**
 * The `digest` J&T wants inside bizContent for order create/cancel/query:
 * Base64(MD5(customerCode + UPPER(HEX(MD5(password + "jadada236t2"))) + privateKey)).
 */
export function bizDigest(c: JtCredentials): string {
  const hashedPassword = toHex(md5(c.customerPassword + 'jadada236t2')).toUpperCase();
  return toBase64(md5(c.customerCode + hashedPassword + c.privateKey));
}

/** The `digest` header on every request: Base64(MD5(bizContentJson + privateKey)). */
export function headerDigest(bizContentJson: string, privateKey: string): string {
  return toBase64(md5(bizContentJson + privateKey));
}

/** application/x-www-form-urlencoded, byte-for-byte what URLSearchParams produces. */
export function formEncode(s: string): string {
  return encodeURIComponent(s)
    .replace(/%20/g, '+')
    .replace(/[!'()~]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * Everything needed to POST one call. Order create/cancel/query carry the
 * customer code and business digest inside bizContent; tracking rejects them.
 */
export function signedRequest(
  creds: JtCredentials,
  bizContent: Record<string, unknown>,
  withAuth: boolean,
  timestamp: number,
): { json: string; body: string; headers: Record<string, string> } {
  const payload = withAuth
    ? { customerCode: creds.customerCode, digest: bizDigest(creds), ...bizContent }
    : bizContent;
  const json = JSON.stringify(payload);
  return {
    json,
    body: `bizContent=${formEncode(json)}`,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      apiAccount: creds.apiAccount,
      digest: headerDigest(json, creds.privateKey),
      timestamp: String(timestamp),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Time
// ─────────────────────────────────────────────────────────────────────────────

// Building an Intl formatter is slow on Hermes; one is shared by every scan.
let cairoFormat: Intl.DateTimeFormat | null = null;

/** Minutes Cairo is ahead of UTC at a given instant (DST included). */
function cairoOffsetMinutes(utcMs: number): number {
  try {
    cairoFormat ??= new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = cairoFormat.formatToParts(new Date(utcMs));
    const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const wall = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour') % 24, n('minute'), n('second'));
    return Math.round((wall - utcMs) / 60_000);
  } catch {
    // No time-zone data: Egypt keeps summer time from late April to late October.
    const m = new Date(utcMs).getUTCMonth() + 1;
    return m >= 5 && m <= 10 ? 180 : 120;
  }
}

/**
 * J&T stamps everything in Cairo wall-clock time with no zone ("2026-09-22
 * 13:42:44"). Returns a proper ISO instant, or null when unparseable.
 */
export function jtTimeToIso(s: string | undefined | null): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec((s ?? '').trim());
  if (!m) return null;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
  // Two passes settle the offset even right at a DST switch.
  let utc = wall - cairoOffsetMinutes(wall - 120 * 60_000) * 60_000;
  utc = wall - cairoOffsetMinutes(utc) * 60_000;
  return new Date(utc).toISOString();
}

// ─────────────────────────────────────────────────────────────────────────────
// Scan → phase
// ─────────────────────────────────────────────────────────────────────────────

/** Scan type codes seen on OKA's live parcels. */
export const JT_SCAN = {
  pickup: 10,
  sending: 50,
  arrival: 92,
  delivering: 94,
  signed: 100,
  problem: 110,
} as const;

export const JT_ORDER_STATUS = {
  unassigned: 100,
  assignedBranch: 101,
  assignedCourier: 102,
  pickedUp: 103,
  cancelled: 104,
} as const;

/** Newest first, whatever order J&T sent them in. */
export function sortScans(scans: JtScan[] | undefined): JtScan[] {
  return (scans ?? [])
    .slice()
    .sort((a, b) => (b.scanTime ?? '').localeCompare(a.scanTime ?? ''));
}

/** Returned-to-sender scans. Chinese 退 ("return") shows up in problemReason. */
export function isReturnScan(s: JtScan): boolean {
  const t = `${s.scanType ?? ''} ${s.problemReason ?? ''}`;
  return /return/i.test(t) || t.includes('退');
}

export function isProblemScan(s: JtScan): boolean {
  return s.scanTypeCode === JT_SCAN.problem || /abnormal|problem/i.test(s.scanType ?? '');
}

/**
 * Which of the five phases a scan proves — created(0), picked up(1),
 * in transit(2), out for delivery(3), delivered(4) — or null for scans that
 * don't move the parcel forward (problems, returns).
 */
export function scanPhase(s: JtScan): number | null {
  if (isReturnScan(s) || isProblemScan(s)) return null;
  const t = (s.scanType ?? '').toLowerCase();
  if (s.scanTypeCode === JT_SCAN.signed || t.startsWith('signing')) return 4;
  if (s.scanTypeCode === JT_SCAN.delivering || t.startsWith('delivery')) return 3;
  if (s.scanTypeCode === JT_SCAN.pickup || t.startsWith('pickup')) return 1;
  // Hub arrivals, departures and every other handling scan.
  return 2;
}

/** Furthest phase reached, like Bosta's timeline: a failed attempt doesn't un-deliver. */
export function jtPhase(shipment: JtShipment): number {
  let phase = 0;
  for (const s of shipment.scans) phase = Math.max(phase, scanPhase(s) ?? 0);
  if (phase === 0 && (shipment.order?.orderStatus ?? 0) >= JT_ORDER_STATUS.pickedUp) {
    if (shipment.order?.orderStatus !== JT_ORDER_STATUS.cancelled) phase = 1;
  }
  return phase;
}

/** Per-phase timestamps, indexed 0–4: the first scan that reached each phase. */
export function jtPhaseTimes(shipment: JtShipment): (string | null)[] {
  const out: (string | null)[] = [jtTimeToIso(shipment.order?.createOrderTime), null, null, null, null];
  // Oldest first, so the first hit per phase wins.
  for (const s of sortScans(shipment.scans).reverse()) {
    const p = scanPhase(s);
    if (p !== null && p > 0 && out[p] === null) out[p] = jtTimeToIso(s.scanTime);
  }
  return out;
}

/** Cancelled before pickup, or on its way back to OKA. */
export function jtIsTerminal(shipment: JtShipment): boolean {
  if (shipment.order?.orderStatus === JT_ORDER_STATUS.cancelled) return true;
  return shipment.scans.some(isReturnScan);
}

/**
 * J&T accepts COD and address changes only until the parcel is picked up;
 * after that the app locks the same fields rather than fail on save.
 */
export function jtIsLocked(shipment: JtShipment): boolean {
  if ((shipment.order?.orderStatus ?? 0) >= JT_ORDER_STATUS.pickedUp) return true;
  return shipment.scans.length > 0;
}

/** Delivery attempts: J&T's own count when present, else delivery scans. */
export function jtAttempts(shipment: JtShipment): number {
  if (typeof shipment.dispatches === 'number') return shipment.dispatches;
  return shipment.scans.filter((s) => scanPhase(s) === 3).length;
}

const ORDER_STATUS_LABEL: Record<number, string> = {
  100: 'Awaiting pickup',
  101: 'Assigned to branch',
  102: 'Assigned to courier',
  103: 'Picked up',
  104: 'Cancelled',
};

/** Short English state for the log and detail screen. */
export function jtStateLabel(shipment: JtShipment): string {
  const latest = sortScans(shipment.scans)[0];
  if (latest?.scanType) return latest.scanType;
  const st = shipment.order?.orderStatus;
  return (st !== undefined && ORDER_STATUS_LABEL[st]) || 'Created';
}

// ─────────────────────────────────────────────────────────────────────────────
// People and problems, parsed out of the scan text
// ─────────────────────────────────────────────────────────────────────────────

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

/** "J&T courier Mohamed Farouk Mosry(01121275898) completed the delivery." */
export function courierFromScan(s: JtScan): { name: string; phone: string } | null {
  if (s.staffName) return { name: collapse(s.staffName), phone: (s.staffContact ?? '').trim() };
  const m = /J&T courier\s+([^()]+?)\s*\(\s*(\+?\d[\d -]{6,})\s*\)/i.exec(s.desc ?? '');
  return m ? { name: collapse(m[1]), phone: m[2].replace(/[ -]/g, '') } : null;
}

/** The courier out on delivery — not the one who collected from the warehouse. */
export function jtCourier(shipment: JtShipment): { name: string; phone: string } | null {
  for (const s of sortScans(shipment.scans)) {
    const p = scanPhase(s);
    if (p === 3 || p === 4) {
      const c = courierFromScan(s);
      if (c) return c;
    }
  }
  return null;
}

/** "please dial branch‘s phone number：01003011680|Ahmed" — zero placeholders ignored. */
export function branchPhoneFromScan(s: JtScan): string | null {
  const m = /branch.{0,2}s phone number\s*[：:]\s*([\d,|A-Za-z ]+)/i.exec(s.desc ?? '');
  if (!m) return null;
  const phone = m[1].match(/\d{7,}/g)?.find((p) => !/^0+$/.test(p));
  return phone ?? null;
}

export type JtProblem = {
  at: string | null;
  code: string | null;
  /** J&T's reason, e.g. "The goods do not match after opening". */
  reason: string;
  /** What the courier typed, often Arabic, e.g. "العميل لغي الطلب". */
  note: string;
  place: string;
  photos: string[];
};

export function problemFromScan(s: JtScan): JtProblem {
  const parts = (s.probleDescription ?? '').split(',').map((p) => p.trim());
  const structured = parts.length >= 3 && /abnormal/i.test(parts[0]);
  return {
    at: jtTimeToIso(s.scanTime),
    code: structured ? parts[1] || null : (s.problemType ?? null),
    reason: structured ? parts[2] : collapse(s.probleDescription || s.desc || s.scanType || ''),
    note: structured ? parts.slice(3).join(', ') : '',
    place: s.scanNetworkName ?? '',
    photos: splitUrls(s.problemPicUrl),
  };
}

/** The current problem: a problem scan with nothing newer superseding it. */
export function jtOpenProblem(shipment: JtShipment): JtProblem | null {
  const latest = sortScans(shipment.scans)[0];
  return latest && isProblemScan(latest) ? problemFromScan(latest) : null;
}

function splitUrls(s: string | undefined): string[] {
  return (s ?? '')
    .split(/,(?=https?:)/)
    .map((u) => u.trim())
    .filter((u) => /^https?:\/\//.test(u));
}

// ─────────────────────────────────────────────────────────────────────────────
// Tracking events for the timeline screen
// ─────────────────────────────────────────────────────────────────────────────

export type JtEventKind = 'pickup' | 'departed' | 'arrived' | 'delivering' | 'delivered' | 'problem' | 'returned' | 'other';

export type JtEvent = {
  kind: JtEventKind;
  at: string | null;
  place: string;
  city: string;
  next: string;
  courier: { name: string; phone: string } | null;
  problem: JtProblem | null;
  /** Signature / proof-of-delivery or problem photos. Links expire after ~7 days. */
  photos: string[];
  otp: string | null;
  /** The handling branch's complaints line, when the scan names one. */
  branchPhone: string | null;
  /** J&T's own English description, for anything the kinds above don't cover. */
  text: string;
};

export function jtEvents(shipment: JtShipment): JtEvent[] {
  return sortScans(shipment.scans).map((s) => {
    const kind: JtEventKind = isReturnScan(s)
      ? 'returned'
      : isProblemScan(s)
        ? 'problem'
        : s.scanTypeCode === JT_SCAN.pickup
          ? 'pickup'
          : s.scanTypeCode === JT_SCAN.sending
            ? 'departed'
            : s.scanTypeCode === JT_SCAN.arrival
              ? 'arrived'
              : scanPhase(s) === 3
                ? 'delivering'
                : scanPhase(s) === 4
                  ? 'delivered'
                  : 'other';
    const problem = kind === 'problem' ? problemFromScan(s) : null;
    return {
      kind,
      at: jtTimeToIso(s.scanTime),
      place: s.scanNetworkName ?? '',
      city: s.scanNetworkCity ?? s.scanNetworkProvince ?? '',
      next: s.nextStopName ?? '',
      courier: courierFromScan(s),
      problem,
      photos: problem
        ? problem.photos
        : [s.sigPicUrl, s.electronicSignaturePicUrl].filter((u): u is string => !!u),
      otp: s.otp ?? null,
      branchPhone: branchPhoneFromScan(s),
      text: collapse((s.desc ?? s.scanType ?? '').replace(/【[^】]*】/g, (m) => m.slice(1, -1) + ' ')),
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Writes: J&T has no edit endpoint — an update resubmits the whole order
// ─────────────────────────────────────────────────────────────────────────────

/** "SHOPIFY2779521" ↔ "#2779521" — how OKA's shipments reference Shopify. */
export function txIdForOrder(orderName: string): string {
  return `SHOPIFY${orderName.replace(/^#/, '').trim()}`;
}

export function orderNameForTxId(txId: string | undefined): string | null {
  const m = /^SHOPIFY(\d+)$/i.exec((txId ?? '').trim());
  return m ? `#${m[1]}` : null;
}

/** J&T echoes numbers back as "+20-0102…"; resubmitting that prefix would double it. */
export function stripJtPhonePrefix(p: string | undefined): string | undefined {
  return p === undefined ? undefined : p.replace(/^\+\d{1,3}-/, '');
}

function partyForSubmit(p: JtParty | undefined): JtParty {
  const src = p ?? {};
  const out: JtParty = { countryCode: src.countryCode || 'EGY' };
  for (const key of ['name', 'prov', 'city', 'area', 'street', 'building', 'floor', 'flats', 'company', 'postCode'] as const) {
    if (src[key]) out[key] = src[key];
  }
  if (src.mobile) out.mobile = stripJtPhonePrefix(src.mobile);
  if (src.phone) out.phone = stripJtPhonePrefix(src.phone);
  return out;
}

/** The courier-facing handling notice OKA puts on every label. */
export const NO_OPEN_NOTICE = 'ممنوع فتح الطرد - مستلزمات شخصية وصحية';

/** Same layout the J&T connector uses: "Item x1 @189 EGP; …; COD: 249 EGP". */
export function buildPickInfo(
  items: { name: string; qty: number; unitPrice: number }[],
  subtotal: number,
  shipping: number,
  cod: number,
): string {
  const r = (n: number) => Math.round(n * 100) / 100;
  const lines = items
    .filter((it) => it.qty > 0)
    .map((it) => `${it.name} x${it.qty} @${r(it.unitPrice)} EGP`);
  lines.push(`Subtotal: ${r(subtotal)} EGP`, `Shipping: ${r(shipping)} EGP`, `COD: ${r(cod)} EGP`);
  const text = lines.join('; ');
  const withNotice = `${text}; ${NO_OPEN_NOTICE}`;
  return (withNotice.length <= 500 ? withNotice : text).slice(0, 500);
}

/** Keep the remark's other details (alt phones…) and only move the COD figure. */
export function rewriteRemark(remark: string | undefined, orderName: string, cod: number): string {
  const amount = Math.round(cod * 100) / 100;
  if (remark && /COD\s*[\d.]+\s*EGP/i.test(remark)) {
    return remark.replace(/COD\s*[\d.]+\s*EGP/i, `COD ${amount} EGP`).slice(0, 200);
  }
  const base = remark?.trim() || `OKA order ${orderName}`;
  return `${base}; COD ${amount} EGP`.slice(0, 200);
}

/**
 * The full addOrder payload for an update (operateType 2), rebuilt from what
 * J&T returned for the order with only the requested fields changed.
 */
export function updatePayload(
  order: JtOrder,
  orderName: string,
  change: { cod?: number; street?: string; pickInfo?: string },
): Record<string, unknown> {
  const cod = change.cod ?? order.itemsValue ?? 0;
  const receiver = partyForSubmit(order.receiver);
  if (change.street) receiver.street = change.street;
  const payload: Record<string, unknown> = {
    txlogisticId: order.txlogisticId,
    operateType: 2,
    expressType: order.expressType || 'EZ',
    deliveryType: order.deliveryType || '04',
    payType: order.payType,
    goodsType: order.goodsType || 'ITN6',
    weight: order.weight,
    totalQuantity: order.totalQuantity ?? 1,
    itemsValue: cod,
    priceCurrency: order.priceCurrency || 'EGP',
    remark: rewriteRemark(order.remark, orderName, cod),
    pickInfo: change.pickInfo ?? order.pickInfo,
    sender: partyForSubmit(order.sender),
    receiver,
  };
  for (const k of Object.keys(payload)) if (payload[k] === undefined) delete payload[k];
  return payload;
}

/**
 * J&T answers an order query that matches nothing with an error instead of an
 * empty list — 999001030 "参数无效:waybillNos size must be between 1 and 1000"
 * (seen live on 2026-09-24). It means "no such parcels", not a bad request.
 */
export function isEmptyLookupError(code: string | number | undefined, msg: string | undefined): boolean {
  // Success comes back as the string "1"; error codes can arrive as numbers.
  return String(code) === '999001030' && /waybillNos size/i.test(msg ?? '');
}

export function cancelPayload(order: JtOrder, reason: string): Record<string, unknown> {
  return {
    txlogisticId: order.txlogisticId,
    reason: reason.slice(0, 50),
    orderType: Number(order.orderType) || 1,
  };
}
