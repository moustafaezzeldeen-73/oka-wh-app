/**
 * Delivery analytics: how many parcels arrive, why the others fail, where they
 * fail, what the failures cost, and the money that came in and went out.
 *
 * Pure (no network, no native imports) so the rules run in the phone app, in
 * `npm run report`, and in scripts/test-logic.ts against live payload shapes.
 *
 * One `ShipmentFact` per Shopify order in the period, built from:
 *   - Shopify: order value, payment method, refunds, province, the courier +
 *     AWB on the fulfillment, in-house tags and delivery cost;
 *   - J&T: getWaybillInfo (signed status, freight charged, attempts), trace
 *     (return scans, problem reasons), getOrders (the COD it collects);
 *   - Bosta: the delivery (state, attempts, exceptions, COD) and, from the
 *     single-delivery endpoint, the fees it deducted.
 */

import { TAG_DELIVERED, TAG_INHOUSE, parcelFromShopify, type CarrierKey } from './model';
import type { BostaDelivery } from './bostaState';
import {
  isProblemScan,
  isReturnScan,
  problemFromScan,
  sortScans,
  type JtOrder,
  type JtScan,
} from './jtState';

// ─────────────────────────────────────────────────────────────────────────────
// Text normalisation (Arabic + English, as customers and couriers type it)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lower-case, strip Arabic diacritics and tatweel, fold the letter variants
 * people use interchangeably (أ/إ/آ → ا, ة → ه, ى → ي), Arabic-Indic digits
 * to ASCII, and punctuation to single spaces.
 */
export function normalizeText(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660))
    .replace(/[^a-z0-9ء-ي]+/g, ' ')
    .trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Governorates
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Egypt's 27 governorates by ISO 3166-2:EG code — the `provinceCode` Shopify
 * stores ("ALX", "C", "GZ"). Aliases cover how J&T (`receiver.prov`, English
 * or Arabic) and Bosta (`dropOffAddress.city.name`, e.g. "Bani Suif",
 * "El Kalioubia") spell them.
 */
export const GOVERNORATES: Record<string, { en: string; ar: string; aliases: string[] }> = {
  ALX: { en: 'Alexandria', ar: 'الإسكندرية', aliases: ['alex', 'alexandria', 'اسكندريه'] },
  ASN: { en: 'Aswan', ar: 'أسوان', aliases: ['aswan'] },
  AST: { en: 'Asyut', ar: 'أسيوط', aliases: ['asyut', 'assiut', 'assuit', 'asiut', 'assiout'] },
  BH: { en: 'Beheira', ar: 'البحيرة', aliases: ['beheira', 'behira', 'al beheira', 'el beheira', 'bohaira', 'بحيره'] },
  BNS: { en: 'Beni Suef', ar: 'بني سويف', aliases: ['beni suef', 'bani suif', 'beni sweif', 'bani sweif', 'beni suef governorate'] },
  C: { en: 'Cairo', ar: 'القاهرة', aliases: ['cairo', 'قاهره'] },
  DK: { en: 'Dakahlia', ar: 'الدقهلية', aliases: ['dakahlia', 'dakahleya', 'el dakahlia', 'dakahliya', 'دقهليه'] },
  DT: { en: 'Damietta', ar: 'دمياط', aliases: ['damietta', 'domiatta', 'dumyat'] },
  FYM: { en: 'Faiyum', ar: 'الفيوم', aliases: ['faiyum', 'fayoum', 'fayum', 'el fayoum', 'fayyum'] },
  GH: { en: 'Gharbia', ar: 'الغربية', aliases: ['gharbia', 'gharbiya', 'el gharbia', 'gharbeya'] },
  GZ: { en: 'Giza', ar: 'الجيزة', aliases: ['giza', 'el giza', 'جيزه'] },
  IS: { en: 'Ismailia', ar: 'الإسماعيلية', aliases: ['ismailia', 'ismailiya', 'ismailia governorate'] },
  KFS: { en: 'Kafr el-Sheikh', ar: 'كفر الشيخ', aliases: ['kafr el sheikh', 'kafr alsheikh', 'kafr elsheikh', 'kafr el shaikh', 'كفرالشيخ'] },
  LX: { en: 'Luxor', ar: 'الأقصر', aliases: ['luxor'] },
  MT: { en: 'Matrouh', ar: 'مطروح', aliases: ['matrouh', 'marsa matrouh', 'matruh', 'مرسي مطروح'] },
  MN: { en: 'Minya', ar: 'المنيا', aliases: ['minya', 'el minya', 'menya', 'al minya'] },
  MNF: { en: 'Monufia', ar: 'المنوفية', aliases: ['monufia', 'menofia', 'menoufia', 'al monufia', 'minufiya'] },
  WAD: { en: 'New Valley', ar: 'الوادي الجديد', aliases: ['new valley', 'el wadi el gedid'] },
  SIN: { en: 'North Sinai', ar: 'شمال سيناء', aliases: ['north sinai'] },
  PTS: { en: 'Port Said', ar: 'بورسعيد', aliases: ['port said', 'بور سعيد'] },
  KB: { en: 'Qalyubia', ar: 'القليوبية', aliases: ['qalyubia', 'el kalioubia', 'kalioubia', 'kalyoubia', 'qaliubiya', 'al qalyubia'] },
  KN: { en: 'Qena', ar: 'قنا', aliases: ['qena'] },
  BA: { en: 'Red Sea', ar: 'البحر الأحمر', aliases: ['red sea'] },
  SHR: { en: 'Sharqia', ar: 'الشرقية', aliases: ['sharqia', 'al sharqia', 'el sharkia', 'sharkia', 'el sharqia', 'ash sharqia'] },
  SHG: { en: 'Sohag', ar: 'سوهاج', aliases: ['sohag', 'suhag'] },
  JS: { en: 'South Sinai', ar: 'جنوب سيناء', aliases: ['south sinai'] },
  SUZ: { en: 'Suez', ar: 'السويس', aliases: ['suez'] },
};

/** Codes from before 2011 that some checkouts still offer, folded into today's. */
const LEGACY_CODES: Record<string, string> = { SU: 'GZ', HU: 'C' };

// `\b` only knows ASCII word characters, so Arabic words are delimited by spaces.
const STRIP_WORDS = /(^|\s)(governorate|gov|محافظه)(?=\s|$)/g;

const GOV_INDEX: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [code, g] of Object.entries(GOVERNORATES)) {
    for (const name of [g.en, g.ar, ...g.aliases]) {
      const k = normalizeText(name).replace(STRIP_WORDS, '').trim();
      m.set(k, code);
      // "الجيزه" and "جيزه" both occur; index the bare form too.
      if (k.startsWith('ال')) m.set(k.slice(2), code);
    }
  }
  return m;
})();

/** Governorate code for a province code or any of the names couriers use; null if unknown. */
export function governorateOf(provinceCode: string | null | undefined, ...names: (string | null | undefined)[]): string | null {
  const code = (provinceCode ?? '').toUpperCase().replace(/^EG-/, '');
  if (GOVERNORATES[code]) return code;
  if (LEGACY_CODES[code]) return LEGACY_CODES[code];
  for (const name of names) {
    const k = normalizeText(name).replace(STRIP_WORDS, '').replace(/\s+/g, ' ').trim();
    if (!k) continue;
    const hit = GOV_INDEX.get(k) ?? (k.startsWith('ال') ? GOV_INDEX.get(k.slice(2)) : undefined);
    if (hit) return hit;
  }
  return null;
}

const AREA_NOISE = /(^|\s)(مدينه|مركز|محافظه|قريه|حي|city|markaz|district|governorate)(?=\s|$)/g;

/**
 * A comparable key for the free-text city customers type ("مدينه نصر",
 * "مدينة نصر" → "نصر"). Null for blanks, placeholders like "0", and a city
 * field that only repeats the governorate ("القاهره" in Cairo). A leading
 * governorate name is dropped: "القاهرة مدينة نصر" → "نصر".
 */
export function areaKey(city: string | null | undefined, gov?: string | null): string | null {
  let k = normalizeText(city).replace(AREA_NOISE, ' ').replace(/\s+/g, ' ').trim();
  if (k.length < 2 || /^\d+$/.test(k)) return null;
  if (governorateOf(null, k)) return null;
  const g = gov ? GOVERNORATES[gov] : undefined;
  if (g) {
    for (const name of [g.en, g.ar, ...g.aliases]) {
      const n = normalizeText(name);
      for (const prefix of [n, n.startsWith('ال') ? n.slice(2) : '']) {
        if (prefix && k.startsWith(`${prefix} `)) k = k.slice(prefix.length + 1).trim();
      }
    }
  }
  return k.length >= 2 ? k : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Failure reasons
// ─────────────────────────────────────────────────────────────────────────────

export const REASON_KEYS = [
  'no_answer',
  'refused',
  'open_package',
  'cancelled',
  'not_home',
  'address',
  'postponed',
  'courier_error',
  'lost',
  'other',
  'none',
] as const;
export type ReasonKey = (typeof REASON_KEYS)[number];

export const REASON_LABEL: Record<ReasonKey, { ar: string; en: string }> = {
  no_answer: { ar: 'مبيردش / التليفون مقفول', en: 'No answer / phone off' },
  refused: { ar: 'رفض الاستلام', en: 'Refused at the door' },
  open_package: { ar: 'عايز يفتح الشحنة', en: 'Wanted to open the parcel' },
  cancelled: { ar: 'العميل لغى', en: 'Customer cancelled' },
  not_home: { ar: 'مش موجود في العنوان', en: 'Not at the address' },
  address: { ar: 'مشكلة في العنوان', en: 'Address problem' },
  postponed: { ar: 'العميل أجّل', en: 'Customer postponed' },
  courier_error: { ar: 'غلطة من شركة الشحن (فرز / فرع)', en: 'Courier error (sorting / branch)' },
  lost: { ar: 'ضايعة أو تالفة', en: 'Lost or damaged' },
  other: { ar: 'أسباب تانية', en: 'Other' },
  none: { ar: 'مفيش سبب مسجل', en: 'No reason recorded' },
};

/** Ordered: the first match wins, so specific phrasings come before generic ones. */
const REASON_RULES: [ReasonKey, RegExp][] = [
  ['open_package', /wants? to open|open the (shipment|parcel|package)|يفتح|فتح الشحنه|فتح الطرد/],
  ['refused', /refus|reject|not match|رفض|مرفوض|مش عايز|مش عاوز/],
  ['no_answer', /no answer|not answer|phone (is )?(off|switched off|closed)|switched off|unreachable|not reachable|لا يرد|مبيردش|مش بيرد|مغلق|مقفول|غير متاح/],
  ['not_home', /not in the address|not at (the )?address|not (available|home)|غير موجود|مش موجود|مسافر/],
  ['address', /address|عنوان|wrong|incorrect|incomplete|unclear|out of (zone|area|coverage)|خارج/],
  // Matched after normalizeText, so تأجيل is تاجيل and مؤجل is موجل.
  ['postponed', /postpon|reschedul|another day|later|change the delivery time|تاجيل|موجل|غدا|بكره/],
  // J&T's own mistakes: "Three-segment code error", "miss-sorting from DC".
  ['courier_error', /three segment|sorting|mis sort|miss sort|wrong (branch|hub)|فرز/],
  ['cancelled', /cancel|الغاء|الغي|لغي|ملغي/],
  ['lost', /lost|damag|مفقود|تالف|ضايع/],
];

/** Fallbacks by courier code when the text says nothing useful (seen live). */
const JT_REASON_CODES: Record<string, ReasonKey> = { '202': 'no_answer', '1004': 'refused' };
const BOSTA_REASON_CODES: Record<number, ReasonKey> = {
  1: 'not_home',
  2: 'address',
  3: 'postponed',
  4: 'open_package',
  8: 'refused',
  13: 'address',
  17: 'no_answer',
};

export function reasonKeyOf(text: string, fallback?: ReasonKey | null): ReasonKey {
  const t = normalizeText(text);
  for (const [key, re] of REASON_RULES) if (re.test(t)) return key;
  return fallback ?? 'other';
}

export type Reason = { key: ReasonKey; text: string };

// ─────────────────────────────────────────────────────────────────────────────
// Inputs
// ─────────────────────────────────────────────────────────────────────────────

type Money = { shopMoney?: { amount?: string | null } | null } | null | undefined;

/** One order, as the analytics export reads it from Shopify. */
export type AnalyticsOrder = {
  id: string;
  name: string;
  tags: string[];
  createdAt: string;
  cancelledAt: string | null;
  displayFinancialStatus?: string | null;
  paymentGatewayNames?: string[] | null;
  currentTotalPriceSet?: Money;
  totalReceivedSet?: Money;
  totalRefundedSet?: Money;
  totalOutstandingSet?: Money;
  fulfillments?: { status: string; createdAt: string; trackingInfo?: { company: string | null; number: string | null }[] }[] | null;
  shippingAddress?: { city?: string | null; province?: string | null; provinceCode?: string | null } | null;
  deliveryCost?: { value: string } | null;
};

/** `/api/waybill/getWaybillInfo`: what J&T charged, and whether it was signed for. */
export type JtWaybill = {
  waybillNo: string;
  /** 1 signed by the customer, 2 signed back by OKA (returned), 0 neither yet. */
  isSign?: number;
  packageChargeWeight?: number;
  totalFreight?: number;
  freight?: number;
  numberOfDispatch?: number;
};

/**
 * Courier data for the period. `read: false` means that courier's API could
 * not be read at all, so its parcels count as "unknown" instead of "waiting".
 */
export type CourierData = {
  jt: {
    read: boolean;
    waybills: Map<string, JtWaybill>;
    scans: Map<string, JtScan[]>;
    orders: Map<string, JtOrder>;
  };
  bosta: {
    read: boolean;
    deliveries: Map<string, BostaDelivery>;
  };
};

export const emptyCourierData = (): CourierData => ({
  jt: { read: false, waybills: new Map(), scans: new Map(), orders: new Map() },
  bosta: { read: false, deliveries: new Map() },
});

// ─────────────────────────────────────────────────────────────────────────────
// Facts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * delivered — the customer has it; failed — returned or on its way back;
 * active — with the courier / on the truck; waiting — booked, not picked up;
 * cancelled — cancelled before pickup; unknown — the courier couldn't be read.
 */
export type Outcome = 'delivered' | 'failed' | 'active' | 'waiting' | 'cancelled' | 'unknown';

export type ShipmentFact = {
  orderId: string;
  order: string;
  createdAt: string;
  /** Null for orders that never left the warehouse. */
  carrier: CarrierKey | null;
  awb: string | null;
  outcome: Outcome;
  gov: string | null;
  area: string | null;
  areaLabel: string | null;
  attempts: number | null;
  /** Why it failed (failed parcels only). */
  reason: Reason | null;
  /** Every failed attempt the courier recorded, delivered or not. */
  attemptReasons: Reason[];
  /** Order value (Shopify's current total). */
  value: number;
  cod: boolean;
  /** Cash collected on delivery by the courier or OKA's driver. */
  collected: number;
  /** False when `collected` is Shopify's figure because the courier's wasn't available. */
  collectedFromCourier: boolean;
  /** Paid online (non-COD orders). */
  online: number;
  refunded: number;
  /** What delivering — or trying to — cost. Null when not known yet. */
  fee: number | null;
};

const amount = (m: Money): number => {
  const n = Number(m?.shopMoney?.amount ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
};
const round2 = (n: number) => Math.round(n * 100) / 100;
const hasTag = (o: AnalyticsOrder, tag: string) => o.tags.some((t) => t.toLowerCase() === tag);

/** Cash on delivery, by gateway name; orders with no gateway are COD if anything is owed. */
export function isCodOrder(o: AnalyticsOrder): boolean {
  const gateways = o.paymentGatewayNames ?? [];
  if (gateways.length === 0) return amount(o.totalOutstandingSet) > 0;
  return gateways.some((g) => /cash on delivery|\bcod\b|الدفع عند الاستلام|manual/i.test(g));
}

/** Egypt's VAT, added by Bosta on top of `shipmentFees` (76 → 86.64 on a live parcel). */
export const BOSTA_VAT = 0.14;

/** Bosta's charge for a parcel: the settled fee when present, else fee + VAT. */
export function bostaFee(d: BostaDelivery): number | null {
  const settled = numOrNull(d.wallet?.cashCycle?.bosta_fees);
  if (settled !== null && settled > 0) return settled;
  if (typeof d.shipmentFees === 'number' && d.shipmentFees > 0) return round2(d.shipmentFees * (1 + BOSTA_VAT));
  return null;
}

/** Bosta parcel outcome from its state and type (type 20 = "Return to Origin"). */
export function bostaOutcome(d: BostaDelivery): Outcome {
  const code = d.state?.code ?? 0;
  const v = (d.state?.value ?? '').toLowerCase();
  const returning = d.type?.code === 20 || /return to origin/i.test(d.type?.value ?? '');
  // Terminal codes are ≥ 20 too, so pickup is judged by its timestamps, not the code.
  const pickedUp = !!(d.state?.pickedUpTime || d.collectedFromBusiness);
  if (code === 45 && !returning) return 'delivered';
  if (code === 46 || returning || /returned/.test(v)) return 'failed';
  if (code === 100 || code === 101 || /lost|damaged/.test(v)) return 'failed';
  if (/terminat|cancel/.test(v) || code === 48 || code === 49) return pickedUp ? 'failed' : 'cancelled';
  if (code === 10 || code === 11 || code < 20) return 'waiting';
  return 'active';
}

/** Customer-side failures only — `attemptType: "return"` is the trip back to OKA. */
export function bostaReasons(d: BostaDelivery): Reason[] {
  return (d.state?.exception ?? [])
    .filter((e) => (e.attemptType ?? 'delivery') !== 'return' && (e.reason ?? '').trim())
    .slice()
    .sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''))
    .map((e) => ({
      key: reasonKeyOf(e.reason ?? '', e.code !== undefined ? BOSTA_REASON_CODES[e.code] : null),
      text: (e.reason ?? '').trim(),
    }));
}

/** J&T outcome from the waybill record and scans (oldest scan first doesn't matter here). */
export function jtOutcome(info: JtWaybill | undefined, scans: JtScan[], order: JtOrder | undefined): Outcome {
  if (info?.isSign === 1) return 'delivered';
  if (info?.isSign === 2) return 'failed';
  if (scans.some(isReturnScan)) return 'failed';
  if (scans.some((s) => s.scanTypeCode === 100 || /^sign/i.test(s.scanType ?? ''))) return 'delivered';
  if (info || scans.length > 0 || (order?.orderStatus ?? 0) === 103) return 'active';
  if (order?.orderStatus === 104) return 'cancelled';
  return 'waiting';
}

/** Problem scans on the way out (before any return scan), oldest first. */
export function jtReasons(scans: JtScan[]): Reason[] {
  const oldestFirst = sortScans(scans).reverse();
  const firstReturn = oldestFirst.findIndex(isReturnScan);
  const outbound = firstReturn === -1 ? oldestFirst : oldestFirst.slice(0, firstReturn);
  return outbound.filter(isProblemScan).map((s) => {
    const p = problemFromScan(s);
    const text = [p.reason, p.note].filter(Boolean).join(' — ') || 'Problem scan';
    // J&T's own reason wins; the courier's free-text note ("لايرد" under an
    // address problem) only decides when the reason says nothing we know.
    let key = reasonKeyOf(p.reason, p.code ? JT_REASON_CODES[p.code] : null);
    if (key === 'other' && p.note) key = reasonKeyOf(p.note);
    return { key, text };
  });
}

/** Build the fact for one order from whatever the couriers returned. */
export function factFor(o: AnalyticsOrder, data: CourierData): ShipmentFact {
  const cod = isCodOrder(o);
  const value = amount(o.currentTotalPriceSet);
  const received = amount(o.totalReceivedSet);
  const refunded = amount(o.totalRefundedSet);
  const outstanding = amount(o.totalOutstandingSet);
  const city = o.shippingAddress?.city ?? null;
  const parcel = parcelFromShopify({
    fulfillments: (o.fulfillments ?? []).map((f) => ({
      status: f.status,
      createdAt: f.createdAt,
      trackingInfo: (f.trackingInfo ?? []).map((t) => ({ company: t.company, number: t.number, url: null })),
    })),
  });

  const gov = governorateOf(o.shippingAddress?.provinceCode, o.shippingAddress?.province);
  const base: ShipmentFact = {
    orderId: o.id,
    order: o.name,
    createdAt: o.createdAt,
    carrier: null,
    awb: null,
    outcome: o.cancelledAt ? 'cancelled' : 'waiting',
    gov,
    area: areaKey(city, gov),
    areaLabel: city?.trim() || null,
    attempts: null,
    reason: null,
    attemptReasons: [],
    value,
    cod,
    collected: 0,
    collectedFromCourier: false,
    online: cod ? 0 : received,
    refunded,
    fee: null,
  };

  const deliveryCost = numOrNull(o.deliveryCost?.value);
  const inhouse = hasTag(o, TAG_INHOUSE) || hasTag(o, TAG_DELIVERED);
  const inhouseFact = (): ShipmentFact => {
    const delivered = hasTag(o, TAG_DELIVERED);
    return {
      ...base,
      carrier: 'inhouse',
      outcome: delivered ? 'delivered' : o.cancelledAt ? 'cancelled' : 'active',
      attempts: delivered ? 1 : null,
      // The driver's cash is recorded by marking the order paid.
      collected: delivered && cod ? received : 0,
      collectedFromCourier: delivered,
      fee: deliveryCost,
    };
  };

  if (!parcel) return inhouse ? inhouseFact() : base;

  if (parcel.carrier === 'jt') {
    const info = data.jt.waybills.get(parcel.awb);
    const scans = data.jt.scans.get(parcel.awb) ?? [];
    const jtOrder = data.jt.orders.get(parcel.awb);
    let outcome: Outcome = data.jt.read ? jtOutcome(info, scans, jtOrder) : 'unknown';
    // A parcel J&T never picked up can still go out on OKA's own truck.
    if (inhouse && (outcome === 'waiting' || outcome === 'cancelled')) return inhouseFact();
    if (o.cancelledAt && outcome === 'waiting') outcome = 'cancelled';
    const reasons = jtReasons(scans);
    const collectedFromCourier = outcome === 'delivered' && typeof jtOrder?.itemsValue === 'number';
    return {
      ...base,
      carrier: 'jt',
      awb: parcel.awb,
      outcome,
      gov: base.gov ?? governorateOf(null, jtOrder?.receiver?.prov),
      attempts: typeof info?.numberOfDispatch === 'number' ? info.numberOfDispatch : null,
      reason: outcome === 'failed' ? (reasons[reasons.length - 1] ?? { key: 'none', text: '' }) : null,
      attemptReasons: reasons,
      collected: outcome === 'delivered' ? (collectedFromCourier ? jtOrder!.itemsValue! : cod ? outstanding : 0) : 0,
      collectedFromCourier,
      fee: numOrNull(info?.totalFreight ?? info?.freight),
    };
  }

  const d = data.bosta.deliveries.get(parcel.awb);
  let outcome: Outcome = d ? bostaOutcome(d) : 'unknown';
  if (inhouse && (outcome === 'waiting' || outcome === 'cancelled')) return inhouseFact();
  if (o.cancelledAt && outcome === 'waiting') outcome = 'cancelled';
  const reasons = d ? bostaReasons(d) : [];
  const walletCod = numOrNull(d?.wallet?.cashCycle?.cod);
  const bostaCollected = outcome === 'delivered' ? (walletCod ?? (typeof d?.cod === 'number' ? d.cod : null)) : null;
  return {
    ...base,
    carrier: 'bosta',
    awb: parcel.awb,
    outcome,
    gov: base.gov ?? governorateOf(null, d?.dropOffAddress?.city?.name, d?.dropOffAddress?.city?.nameAr),
    attempts: d ? (d.numberOfAttempts ?? d.attemptsCount ?? null) : null,
    reason: outcome === 'failed' ? (reasons[reasons.length - 1] ?? { key: 'none', text: '' }) : null,
    attemptReasons: reasons,
    collected: outcome === 'delivered' ? (bostaCollected ?? (cod ? outstanding : 0)) : 0,
    collectedFromCourier: bostaCollected !== null,
    fee: d ? bostaFee(d) : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Report
// ─────────────────────────────────────────────────────────────────────────────

export type Rates = {
  shipments: number;
  delivered: number;
  failed: number;
  active: number;
  waiting: number;
  cancelled: number;
  unknown: number;
  /** Delivered + failed: the parcels whose story is over. Rates use these. */
  closed: number;
  deliveryRate: number | null;
  failureRate: number | null;
  /** Delivered on the first attempt, of delivered parcels whose attempts are known. */
  firstAttemptRate: number | null;
  avgAttempts: number | null;
};

export type CarrierReport = Rates & {
  carrier: CarrierKey;
  /** Cash collected on delivered parcels. */
  collected: number;
  /** Courier fees (or in-house costs) including estimates. */
  fees: number;
  /** Part of `fees` estimated from the average because the courier didn't say. */
  estimatedFees: number;
  /** collected − fees: what the courier owes OKA (in-house: cash left after costs). */
  net: number;
  failedCost: number;
};

export type PlaceReport = Rates & {
  key: string;
  en: string;
  ar: string;
  failedCost: number;
  /** Failure rate pulled toward the overall rate for small samples — the sort key. */
  score: number;
};

export type ReasonReport = {
  key: ReasonKey;
  count: number;
  share: number;
  /** The courier's own wording, most common first. */
  examples: { text: string; count: number }[];
};

export type AnalyticsReport = {
  from: string;
  to: string;
  orders: number;
  /** Orders with no courier and not on the in-house truck. */
  notShipped: number;
  cancelledOrders: number;
  /**
   * Booked with a courier more than `staleDays` ago and still not picked up —
   * Shopify shows them fulfilled, so nobody else notices.
   */
  stale: { count: number; orders: string[]; days: number };
  totals: Rates;
  carriers: CarrierReport[];
  /** Why parcels failed: the last recorded reason per failed parcel. */
  reasons: ReasonReport[];
  /** Every failed attempt, including parcels delivered on a later try. */
  attemptReasons: ReasonReport[];
  /** Worst first. */
  governorates: PlaceReport[];
  /** Worst first; only areas with at least `minAreaClosed` finished parcels. */
  areas: PlaceReport[];
  failed: {
    count: number;
    /** Courier fees paid on parcels that came back. */
    cost: number;
    avgCost: number | null;
    /** Order value that went out and came back unsold. */
    uncollected: number;
    estimated: number;
  };
  money: {
    in: { jt: number; bosta: number; inhouse: number; online: number; total: number };
    out: { jt: number; bosta: number; inhouse: number; refunds: number; total: number };
    balance: number;
    /** COD still out with couriers on active parcels. */
    onTheRoad: number;
    /** Part of `out` estimated from averages. */
    estimated: number;
    /** Part of `in` taken from Shopify because the courier's figure wasn't loaded. */
    fromShopify: number;
  };
};

const CARRIERS: CarrierKey[] = ['jt', 'bosta', 'inhouse'];

export function rates(facts: ShipmentFact[]): Rates {
  const shipped = facts.filter((f) => f.carrier !== null);
  const count = (o: Outcome) => shipped.filter((f) => f.outcome === o).length;
  const delivered = count('delivered');
  const failed = count('failed');
  const closed = delivered + failed;
  const withAttempts = shipped.filter((f) => f.outcome === 'delivered' && f.attempts !== null && f.attempts > 0);
  const closedAttempts = shipped.filter((f) => (f.outcome === 'delivered' || f.outcome === 'failed') && f.attempts !== null);
  return {
    shipments: shipped.length,
    delivered,
    failed,
    active: count('active'),
    waiting: count('waiting'),
    cancelled: count('cancelled'),
    unknown: count('unknown'),
    closed,
    deliveryRate: closed ? delivered / closed : null,
    failureRate: closed ? failed / closed : null,
    firstAttemptRate: withAttempts.length
      ? withAttempts.filter((f) => (f.attempts ?? 0) <= 1).length / withAttempts.length
      : null,
    avgAttempts: closedAttempts.length
      ? closedAttempts.reduce((s, f) => s + (f.attempts ?? 0), 0) / closedAttempts.length
      : null,
  };
}

function reasonReport(reasons: Reason[]): ReasonReport[] {
  const by = new Map<ReasonKey, Map<string, number>>();
  for (const r of reasons) {
    const texts = by.get(r.key) ?? new Map<string, number>();
    const t = r.text.trim();
    if (t) texts.set(t, (texts.get(t) ?? 0) + 1);
    else texts.set('', (texts.get('') ?? 0) + 1);
    by.set(r.key, texts);
  }
  const total = reasons.length;
  return [...by.entries()]
    .map(([key, texts]) => {
      const count = [...texts.values()].reduce((a, b) => a + b, 0);
      return {
        key,
        count,
        share: total ? count / total : 0,
        examples: [...texts.entries()]
          .filter(([text]) => text)
          .map(([text, n]) => ({ text, count: n }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 3),
      };
    })
    .sort((a, b) => b.count - a.count);
}

/** Smoothing weight: a place needs a few parcels before its own rate dominates. */
const PRIOR = 4;

function placeReports(
  facts: ShipmentFact[],
  keyOf: (f: ShipmentFact) => string | null,
  labelOf: (key: string, first: ShipmentFact) => { en: string; ar: string },
  overallFailure: number,
  minClosed: number,
  feeOf: (f: ShipmentFact) => number,
): PlaceReport[] {
  const groups = new Map<string, ShipmentFact[]>();
  for (const f of facts) {
    const k = keyOf(f);
    if (!k || f.carrier === null) continue;
    const g = groups.get(k) ?? [];
    g.push(f);
    groups.set(k, g);
  }
  const out: PlaceReport[] = [];
  for (const [key, group] of groups) {
    const r = rates(group);
    if (r.closed < minClosed) continue;
    out.push({
      ...r,
      key,
      ...labelOf(key, group[0]),
      failedCost: round2(group.filter((f) => f.outcome === 'failed').reduce((s, f) => s + feeOf(f), 0)),
      score: (r.failed + PRIOR * overallFailure) / (r.closed + PRIOR),
    });
  }
  // A place with no returns isn't "worst" however few parcels it had.
  return out.sort((a, b) => Number(b.failed > 0) - Number(a.failed > 0) || b.score - a.score || b.failed - a.failed);
}

/**
 * Roll the facts up. Fees a courier didn't report on a finished parcel are
 * estimated at that courier's average for the period, and reported as such.
 */
export function summarize(
  facts: ShipmentFact[],
  opts: { from: string; to: string; minAreaClosed?: number; now?: Date; staleDays?: number },
): AnalyticsReport {
  const minAreaClosed = opts.minAreaClosed ?? 3;
  const staleDays = opts.staleDays ?? 3;
  const staleBefore = (opts.now ?? new Date()).getTime() - staleDays * 86_400_000;
  const staleFacts = facts.filter(
    (f) =>
      (f.carrier === 'jt' || f.carrier === 'bosta') &&
      f.outcome === 'waiting' &&
      new Date(f.createdAt).getTime() < staleBefore,
  );
  const finished = (f: ShipmentFact) => f.outcome === 'delivered' || f.outcome === 'failed';

  // Average known fee per courier, over finished parcels.
  const avgFee = new Map<CarrierKey, number>();
  for (const c of CARRIERS) {
    const known = facts.filter((f) => f.carrier === c && finished(f) && f.fee !== null);
    if (known.length) avgFee.set(c, known.reduce((s, f) => s + (f.fee ?? 0), 0) / known.length);
  }
  const isEstimated = (f: ShipmentFact) =>
    f.fee === null && f.carrier !== null && f.carrier !== 'inhouse' && finished(f) && avgFee.has(f.carrier);
  const feeOf = (f: ShipmentFact): number => {
    if (f.fee !== null) return f.fee;
    return isEstimated(f) ? (avgFee.get(f.carrier!) ?? 0) : 0;
  };

  const totals = rates(facts);
  const overallFailure = totals.failureRate ?? 0;

  const carriers: CarrierReport[] = CARRIERS.map((carrier) => {
    const mine = facts.filter((f) => f.carrier === carrier);
    const collected = mine.filter((f) => f.outcome === 'delivered').reduce((s, f) => s + f.collected, 0);
    const fees = mine.reduce((s, f) => s + feeOf(f), 0);
    const estimatedFees = mine.filter(isEstimated).reduce((s, f) => s + feeOf(f), 0);
    return {
      ...rates(mine),
      carrier,
      collected: round2(collected),
      fees: round2(fees),
      estimatedFees: round2(estimatedFees),
      net: round2(collected - fees),
      failedCost: round2(mine.filter((f) => f.outcome === 'failed').reduce((s, f) => s + feeOf(f), 0)),
    };
  }).filter((c) => c.shipments > 0);

  const failedFacts = facts.filter((f) => f.outcome === 'failed');
  const failedCost = failedFacts.reduce((s, f) => s + feeOf(f), 0);

  const byCarrierIn = (c: CarrierKey) =>
    round2(facts.filter((f) => f.carrier === c && f.outcome === 'delivered').reduce((s, f) => s + f.collected, 0));
  const byCarrierOut = (c: CarrierKey) => round2(facts.filter((f) => f.carrier === c).reduce((s, f) => s + feeOf(f), 0));
  const moneyIn = {
    jt: byCarrierIn('jt'),
    bosta: byCarrierIn('bosta'),
    inhouse: byCarrierIn('inhouse'),
    online: round2(facts.reduce((s, f) => s + f.online, 0)),
    total: 0,
  };
  moneyIn.total = round2(moneyIn.jt + moneyIn.bosta + moneyIn.inhouse + moneyIn.online);
  const moneyOut = {
    jt: byCarrierOut('jt'),
    bosta: byCarrierOut('bosta'),
    inhouse: byCarrierOut('inhouse'),
    refunds: round2(facts.reduce((s, f) => s + f.refunded, 0)),
    total: 0,
  };
  moneyOut.total = round2(moneyOut.jt + moneyOut.bosta + moneyOut.inhouse + moneyOut.refunds);

  return {
    from: opts.from,
    to: opts.to,
    orders: facts.length,
    notShipped: facts.filter((f) => f.carrier === null && f.outcome !== 'cancelled').length,
    cancelledOrders: facts.filter((f) => f.carrier === null && f.outcome === 'cancelled').length,
    stale: { count: staleFacts.length, orders: staleFacts.map((f) => f.order).slice(0, 50), days: staleDays },
    totals,
    carriers,
    reasons: reasonReport(failedFacts.map((f) => f.reason ?? { key: 'none', text: '' })),
    attemptReasons: reasonReport(facts.flatMap((f) => f.attemptReasons)),
    governorates: placeReports(
      facts,
      (f) => f.gov,
      (key) => ({ en: GOVERNORATES[key]?.en ?? key, ar: GOVERNORATES[key]?.ar ?? key }),
      overallFailure,
      1,
      feeOf,
    ),
    areas: placeReports(
      facts,
      (f) => (f.area && f.gov ? `${f.gov}:${f.area}` : null),
      (_key, first) => {
        const gov = first.gov ? GOVERNORATES[first.gov] : undefined;
        const label = first.areaLabel ?? first.area ?? '';
        return { en: gov ? `${label}, ${gov.en}` : label, ar: gov ? `${label}، ${gov.ar}` : label };
      },
      overallFailure,
      minAreaClosed,
      feeOf,
    ),
    failed: {
      count: failedFacts.length,
      cost: round2(failedCost),
      avgCost: failedFacts.length ? round2(failedCost / failedFacts.length) : null,
      uncollected: round2(failedFacts.reduce((s, f) => s + (f.cod ? f.value : 0), 0)),
      estimated: round2(failedFacts.filter(isEstimated).reduce((s, f) => s + feeOf(f), 0)),
    },
    money: {
      in: moneyIn,
      out: moneyOut,
      balance: round2(moneyIn.total - moneyOut.total),
      onTheRoad: round2(facts.filter((f) => f.outcome === 'active' && f.cod).reduce((s, f) => s + f.value, 0)),
      estimated: round2(facts.filter(isEstimated).reduce((s, f) => s + feeOf(f), 0)),
      fromShopify: round2(
        facts
          .filter((f) => f.outcome === 'delivered' && f.carrier !== 'inhouse' && !f.collectedFromCourier)
          .reduce((s, f) => s + f.collected, 0),
      ),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Periods
// ─────────────────────────────────────────────────────────────────────────────

export const PERIOD_KEYS = ['7d', '14d', '30d', 'month', 'lastMonth'] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];

/** [from, to) in the device's local time — Cairo on the warehouse phones. */
export function periodRange(key: PeriodKey, now: Date = new Date()): { from: Date; to: Date } {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const tomorrow = new Date(startOfDay(now).getTime());
  tomorrow.setDate(tomorrow.getDate() + 1);
  const daysBack = (n: number) => {
    const d = startOfDay(now);
    d.setDate(d.getDate() - (n - 1));
    return d;
  };
  switch (key) {
    case '7d':
      return { from: daysBack(7), to: tomorrow };
    case '14d':
      return { from: daysBack(14), to: tomorrow };
    case '30d':
      return { from: daysBack(30), to: tomorrow };
    case 'month':
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: tomorrow };
    case 'lastMonth':
      return {
        from: new Date(now.getFullYear(), now.getMonth() - 1, 1),
        to: new Date(now.getFullYear(), now.getMonth(), 1),
      };
  }
}
