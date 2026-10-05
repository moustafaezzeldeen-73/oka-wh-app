/**
 * Logic tests for the Shopify↔Bosta join, state mapping, phone normalisation
 * and order-note rendering.
 *
 * Fixtures are verbatim payloads captured from OKA's live Shopify Admin API and
 * live Bosta v2 API — not invented shapes — so a schema drift on either side
 * shows up here.
 *
 *   npm run test:logic
 */

import { createHash } from 'node:crypto';

import {
  bostaParcel,
  buildOrder,
  carrierOfTracking,
  jtParcel,
  money,
  normalizePhone,
  packageDescription,
  parcelFromShopify,
  photoIdsOf,
  pickParcel,
  TAG_DELIVERED,
  TAG_INHOUSE,
  waNumber,
} from '../src/api/model';
import {
  bizDigest,
  branchPhoneFromScan,
  buildPickInfo,
  cancelPayload,
  courierFromScan,
  formEncode,
  isEmptyLookupError,
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
  NO_OPEN_NOTICE,
  orderNameForTxId,
  problemFromScan,
  rewriteRemark,
  scanPhase,
  signedRequest,
  stripJtPhonePrefix,
  txIdForOrder,
  updatePayload,
  type JtOrder,
  type JtParty,
  type JtScan,
  type JtShipment,
} from '../src/api/jtState';
import { md5, toBase64, toHex } from '../src/api/md5';
import {
  courierOf,
  isLockedState,
  isTerminalState,
  phaseFromState,
  phaseFromTimeline,
  timesFromTimeline,
  type BostaDelivery,
} from '../src/api/bostaState';
import {
  makeEntry,
  parseActivity,
  renderNote,
  type ActivityEntry,
} from '../src/api/activityLog';
import { applyFilter, callStatus, contactHistory, isRerouted, orderPhotos, truckRefusal } from '../src/state/selectors';
import { stringsFor } from '../src/i18n/strings';
import type { ShopifyOrder } from '../src/api/shopify';
import { createTokenSource, ShopifyTokenError, type TokenFetcher } from '../src/api/shopifyToken';
import {
  areaKey,
  bostaFee,
  bostaOutcome,
  bostaReasons,
  emptyCourierData,
  factFor,
  governorateOf,
  isCodOrder,
  jtOutcome,
  jtReasons,
  normalizeText,
  periodRange,
  reasonKeyOf,
  summarize,
  type AnalyticsOrder,
  type JtWaybill,
  type ShipmentFact,
} from '../src/api/analytics';
import { exportQuery, loadAnalytics, parseJsonl, type AnalyticsSources } from '../src/api/analyticsLoader';
import {
  audioMimeType,
  cairoStamp,
  geminiCanTranscribe,
  phoneKey,
  pickRecording,
  recordingFilename,
  type RecordingCandidate,
} from '../src/api/callRecording';
import {
  parseTranscription,
  transcriptionPrompt,
  transcriptionRequest,
  TranscriptionError,
} from '../src/api/geminiTranscript';

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? `\n      ${detail}` : ''}`);
  }
}

function eq<T>(name: string, actual: T, expected: T) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, a === e ? undefined : `expected ${e}\n      actual   ${a}`);
}

function section(title: string) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures — captured live on 2026-08-12
// ─────────────────────────────────────────────────────────────────────────────

/** Live Shopify order #2623621 (Alexandria, 5 line items, unfulfilled). */
const SHOPIFY_ORDER = {
  id: 'gid://shopify/Order/7694481097002',
  name: '#2623621',
  note: null,
  tags: ['to_be_shipped'],
  createdAt: '2026-08-12T21:05:59Z',
  cancelledAt: null,
  displayFulfillmentStatus: 'UNFULFILLED',
  displayFinancialStatus: 'PENDING',
  currentSubtotalPriceSet: { shopMoney: { amount: '638.0', currencyCode: 'EGP' } },
  totalShippingPriceSet: { shopMoney: { amount: '36.0', currencyCode: 'EGP' } },
  currentTotalPriceSet: { shopMoney: { amount: '674.0', currencyCode: 'EGP' } },
  customer: { id: 'gid://shopify/Customer/10793022718250', displayName: 'Amr Aly', phone: null },
  shippingAddress: {
    name: 'Amr Aly',
    phone: '1127064476',
    address1: 'الاسكندريه سيدي بشر خليل حماده',
    address2: null,
    city: 'الإسكندرية',
    province: 'Alexandria',
    country: 'Egypt',
  },
  lineItems: {
    nodes: [
      {
        id: 'gid://shopify/LineItem/19183343829290',
        title: 'Coal gaze protector + Bowl Free',
        quantity: 1,
        sku: 'EX-BOWL-P-02-METAL',
        variantTitle: null,
        variant: {
          id: 'gid://shopify/ProductVariant/46442383835434',
          title: 'Default Title',
          price: '94.00',
          image: null,
        },
        image: { url: 'https://cdn.shopify.com/s/files/1/0812/4881/3354/files/IMG-0178.png' },
        originalUnitPriceSet: { shopMoney: { amount: '94.0' } },
      },
      {
        id: 'gid://shopify/LineItem/19183343862058',
        title: 'OKA Silicon Gourmets - Hose / bowl',
        quantity: 2,
        sku: 'EX-ACC-P-01-SILICON',
        variantTitle: null,
        variant: {
          id: 'gid://shopify/ProductVariant/46037716730154',
          title: 'Default Title',
          price: '10.00',
          image: null,
        },
        image: { url: 'https://cdn.shopify.com/s/files/1/0812/4881/3354/files/IMG-0176.png' },
        originalUnitPriceSet: { shopMoney: { amount: '10.0' } },
      },
      {
        id: 'gid://shopify/LineItem/19183343927594',
        title: 'OKA Cobra + OKA base',
        quantity: 1,
        sku: null,
        variantTitle: null,
        variant: {
          id: 'gid://shopify/ProductVariant/50678225207594',
          title: 'Default Title',
          price: '357.00',
          image: null,
        },
        image: { url: 'https://cdn.shopify.com/s/files/1/0812/4881/3354/files/3_bec1104f.png' },
        originalUnitPriceSet: { shopMoney: { amount: '357.0' } },
      },
    ],
  },
  metafield: null,
} as unknown as ShopifyOrder;

/** Live Bosta delivery 6428689600 — Processing, real courier holding the parcel. */
const BOSTA_WITH_COURIER = {
  _id: 'OkDxqlC9zuEH8Pn1Hgd8E',
  trackingNumber: '6428689600',
  businessReference: '#2621321',
  cod: 355,
  state: { value: 'Processing', code: 24, childState: null, deliveryTime: null },
  receiver: {
    _id: 'uJmLTFUHzlKuUOnEVNPR6',
    phone: '+201202324887',
    fullName: 'ساره السيد',
    ranking: 100,
  },
  sender: { _id: 'tYh88eMFmbshuRZCAZDj2', name: 'OKA', phone: '+201025843317', type: 'BUSINESS_ACCOUNT' },
  holder: { _id: 'OcWhw5AP4bJQ2DrAfL7ia', phone: '01210699218', name: 'Ahmed Mohamed Mansour' },
  dropOffAddress: {
    city: { _id: 'Jrb6X6ucjiYgMP4T7', name: 'Alexandria', nameAr: 'الاسكندريه' },
    firstLine: 'الملاحه امام قسم ثالث المنتزه',
    secondLine: 'ثالث عماره في الشارع الدور الرابع',
    addressClarityScore: 85,
    isBadAddress: false,
  },
  attemptsCount: 0,
  createdAt: 'Wed Aug 12 2026 06:43:59 GMT+0000 (Coordinated Universal Time)',
} as unknown as BostaDelivery;

/** Live Bosta delivery 7433950202 — Created, still held by the business account. */
const BOSTA_NO_COURIER = {
  _id: 'COVJ4zM3kK2gfd9VlXxIl',
  trackingNumber: '7433950202',
  businessReference: '#2623621',
  cod: 674,
  state: { value: 'Created', code: 10, childState: null, deliveryTime: null },
  receiver: { _id: 'xALXiJlXDUZHBWhYeVYZ4', phone: '+201039262923', fullName: 'على كمال بيه' },
  sender: { _id: 'tYh88eMFmbshuRZCAZDj2', name: 'OKA', phone: '+201025843317', type: 'BUSINESS_ACCOUNT' },
  holder: { _id: 'tYh88eMFmbshuRZCAZDj2', phone: '+201025843317', name: 'OKA', role: 'BUSINESS_ADMIN' },
  dropOffAddress: {
    city: { _id: 'RrDhS8YYsXAwZ9Zfo', name: 'Dakahlia', nameAr: 'الدقهليه' },
    firstLine: 'الانشاصيه مركز اجا دقهليه',
    addressClarityScore: 100,
    isBadAddress: false,
  },
  attemptsCount: 0,
} as unknown as BostaDelivery;

// ─────────────────────────────────────────────────────────────────────────────

section("Bosta timeline (authoritative) — live payload for AWB 6428689600");
{
  // Verbatim from GET /deliveries/business/6428689600 on 2026-08-12.
  const timeline = [
    { value: 'new', code: 10, done: true, date: '2026-08-12T06:43:59.064Z' },
    { value: 'picked_up', code: 21, done: true, date: '2026-08-12T10:28:53.160Z' },
    { value: 'in_transit', code: 30, done: true, date: '2026-08-12T18:09:56.897Z' },
    { value: 'out_for_delivery', code: 41, done: false },
    { value: 'delivered', code: 45, done: false },
  ];

  eq('phase = last done entry', phaseFromTimeline(timeline), 2);
  eq('times land in phase order', timesFromTimeline(timeline)[1], '2026-08-12T10:28:53.160Z');
  eq('undone phases have no timestamp', timesFromTimeline(timeline)[3], null);
  eq('missing timeline → null (caller falls back)', phaseFromTimeline(undefined), null);
  eq('empty timeline → null', phaseFromTimeline([]), null);

  const delivered = timeline.map((t) => ({ ...t, done: true, date: t.date ?? '2026-08-13T09:00:00Z' }));
  eq('fully delivered → phase 4', phaseFromTimeline(delivered), 4);

  // The timeline must override the coarser state-code guess.
  const withTimeline = { ...BOSTA_WITH_COURIER, timeline } as BostaDelivery;
  const o = buildOrder(SHOPIFY_ORDER, bostaParcel(withTimeline), [], false);
  eq('order phase comes from the timeline', o.trackPhase, 2);
  eq('order carries phase timestamps', o.phaseTimes[2], '2026-08-12T18:09:56.897Z');
}

section('Bosta state → tracking phase');
eq('Created (10) → phase 0', phaseFromState(10, 'Created'), 0);
eq('Picked up (20) → phase 1', phaseFromState(20, 'Picked up'), 1);
eq('Processing (24) → phase 2', phaseFromState(24, 'Processing'), 2);
eq('In transit (30) → phase 2', phaseFromState(30, 'In transit'), 2);
eq('Out for delivery (41) → phase 3', phaseFromState(41, 'Out for delivery'), 3);
eq('Delivered (45) → phase 4', phaseFromState(45, 'Delivered'), 4);
eq('Received at warehouse (24) → phase 2', phaseFromState(24, 'Received at warehouse'), 2);
eq('Picked up from business (21) → phase 1', phaseFromState(21, 'Picked up from business'), 1);
eq('unknown code, Delivered label → phase 4', phaseFromState(999, 'Delivered'), 4);
eq('undefined code → phase 0', phaseFromState(undefined), 0);

section('Edit locking and terminal states');
eq('Created is editable', isLockedState(10), false);
eq('Picked up is locked', isLockedState(20), true);
eq('Processing is locked', isLockedState(24), true);
eq('Terminated (49) is terminal', isTerminalState(49, 'Terminated'), true);
eq('Returned to business (46) is terminal', isTerminalState(46, 'Returned to business'), true);
eq('Returned label is terminal', isTerminalState(30, 'Returned to business'), true);
eq('Delivered (45) is NOT terminal', isTerminalState(45, 'Delivered'), false);

section('Courier resolution (business account must not read as a courier)');
eq('real holder → courier', courierOf(BOSTA_WITH_COURIER)?.name, 'Ahmed Mohamed Mansour');
eq('courier phone carried', courierOf(BOSTA_WITH_COURIER)?.phone, '01210699218');
eq('BUSINESS_ADMIN holder → no courier', courierOf(BOSTA_NO_COURIER), null);
eq('null delivery → no courier', courierOf(null), null);

section('Egyptian phone normalisation');
eq('bare 10-digit (live Shopify value)', normalizePhone('1127064476'), '+201127064476');
eq('leading zero', normalizePhone('01501805250'), '+201501805250');
eq('already E.164', normalizePhone('+201202324887'), '+201202324887');
eq('00 international prefix', normalizePhone('00201025843317'), '+201025843317');
eq('20 country prefix', normalizePhone('201039262923'), '+201039262923');
eq('spaces and dashes stripped', normalizePhone('012-1069 9218'), '+201210699218');
eq('empty stays empty', normalizePhone(''), '');
eq('WhatsApp form drops the plus', waNumber('+201202324887'), '201202324887');

section('Shopify × Bosta join');
{
  const o = buildOrder(SHOPIFY_ORDER, bostaParcel(BOSTA_NO_COURIER), [], false);
  eq('AWB from Bosta', o.awb, '7433950202');
  eq('order name from Shopify', o.name, '#2623621');
  eq('COD prefers Bosta', o.cod, 674);
  eq('subtotal from Shopify', o.subtotal, 638);
  eq('shipping from Shopify', o.shipping, 36);
  eq('item count sums quantities', o.itemCount, 4);
  eq('clarity from Bosta', o.clarity, 100);
  eq('city (EN) from Bosta', o.city, 'Dakahlia');
  eq('phone normalised', o.phone, '+201127064476');
  eq('editable while Created', o.locked, false);
  eq('status is ready once booked', o.status, 'ready');
  eq(
    'thumbnail is the highest-value line',
    o.thumb,
    'https://cdn.shopify.com/s/files/1/0812/4881/3354/files/3_bec1104f.png',
  );
  eq('initials from customer', o.initials, 'AA');

  const ar = buildOrder(SHOPIFY_ORDER, bostaParcel(BOSTA_NO_COURIER), [], true);
  eq('city (AR) from Bosta', ar.city, 'الدقهليه');
}

{
  const o = buildOrder(SHOPIFY_ORDER, bostaParcel(BOSTA_WITH_COURIER), [], false);
  eq('locked once picked up', o.locked, true);
  eq('phase 2 → transit chip', o.status, 'transit');
  eq('rank from Bosta receiver', o.rank, 100);
  eq('courier surfaced', o.courier?.name, 'Ahmed Mohamed Mansour');
}

{
  const o = buildOrder(SHOPIFY_ORDER, null, [], false);
  eq('no shipment → null AWB', o.awb, null);
  eq('no shipment → COD falls back to Shopify total', o.cod, 674);
  eq('no shipment → status new', o.status, 'new');
  eq('no shipment → editable', o.locked, false);
  eq('address falls back to Shopify', o.address, 'الاسكندريه سيدي بشر خليل حماده, الإسكندرية');
}

{
  const badAddr = {
    ...BOSTA_NO_COURIER,
    dropOffAddress: { ...BOSTA_NO_COURIER.dropOffAddress, isBadAddress: true },
  } as BostaDelivery;
  eq('isBadAddress → badaddr chip', buildOrder(SHOPIFY_ORDER, bostaParcel(badAddr), [], false).status, 'badaddr');

  const lowClarity = {
    ...BOSTA_NO_COURIER,
    dropOffAddress: { ...BOSTA_NO_COURIER.dropOffAddress, addressClarityScore: 34 },
  } as BostaDelivery;
  eq(
    'clarity under 40 → badaddr chip',
    buildOrder(SHOPIFY_ORDER, bostaParcel(lowClarity), [], false).status,
    'badaddr',
  );

  const cancelled = { ...SHOPIFY_ORDER, cancelledAt: '2026-08-12T22:00:00Z' } as ShopifyOrder;
  eq(
    'Shopify cancellation wins',
    buildOrder(cancelled, bostaParcel(BOSTA_WITH_COURIER), [], false).status,
    'cancelled',
  );

  const terminated = {
    ...BOSTA_WITH_COURIER,
    state: { value: 'Terminated', code: 49 },
  } as BostaDelivery;
  eq(
    'Bosta termination → cancelled chip',
    buildOrder(SHOPIFY_ORDER, bostaParcel(terminated), [], false).status,
    'cancelled',
  );
}

section('Order note journal');
{
  const entries: ActivityEntry[] = [
    {
      id: 'a1',
      at: '2026-08-12T09:00:00Z',
      kind: 'call',
      text: 'Call to customer +201127064476 — answered, confirmed',
      durationSec: 42,
      outcome: 'answered',
    },
    {
      id: 'a2',
      at: '2026-08-12T09:05:00Z',
      kind: 'photo',
      text: 'Photo of order contents attached',
      mediaUrl: 'https://cdn.shopify.com/s/files/1/0812/4881/3354/files/oka-2623621.jpg',
    },
  ];

  const note = renderNote(null, entries);
  check('journal carries the marker', note.includes('── OKA WAREHOUSE LOG ──'));
  check('newest entry first', note.indexOf('Photo of order') < note.indexOf('Call to customer'));
  check('call duration rendered', note.includes('[00:42]'));
  check('media URL linked', note.includes('oka-2623621.jpg'));
  check('timestamps in Cairo time', note.includes('12 Aug'));

  const withMerchantText = renderNote('Customer asked for evening delivery.', entries);
  check('merchant text preserved', withMerchantText.startsWith('Customer asked for evening delivery.'));

  // Re-rendering must not stack duplicate journals.
  const rerendered = renderNote(withMerchantText, entries);
  eq(
    'journal is replaced, not appended',
    rerendered.split('── OKA WAREHOUSE LOG ──').length - 1,
    1,
  );
  check('merchant text survives re-render', rerendered.startsWith('Customer asked for evening delivery.'));

  // Shopify rejects notes over 5000 characters.
  const many: ActivityEntry[] = Array.from({ length: 200 }, (_, i) => ({
    id: `e${i}`,
    at: new Date(Date.UTC(2026, 7, 12, 0, i)).toISOString(),
    kind: 'note' as const,
    text: `Entry ${i} — ${'x'.repeat(120)}`,
  }));
  const big = renderNote('merchant text', many);
  check(`long log stays under Shopify's 5000-char limit (${big.length})`, big.length <= 5000);
  check('overflow is disclosed', big.includes('earlier entries in the oka.activity_log metafield'));
}

section('Activity metafield round-trip');
{
  const entry = makeEntry('call', 'Call to customer', { durationSec: 12, outcome: 'noanswer' });
  check('entry gets a unique id', typeof entry.id === 'string' && entry.id.length > 4);
  check('entry timestamped ISO', !Number.isNaN(Date.parse(entry.at)));

  const holder = { metafield: { value: JSON.stringify([entry]) } };
  eq('round-trips through the metafield', parseActivity(holder).length, 1);
  eq('outcome preserved', parseActivity(holder)[0].outcome, 'noanswer');
  eq('missing metafield → empty', parseActivity({ metafield: null }).length, 0);
  eq('corrupt JSON → empty, no throw', parseActivity({ metafield: { value: '{oops' } }).length, 0);
}

section('List filters and derived call status');
{
  const base = buildOrder(SHOPIFY_ORDER, bostaParcel(BOSTA_NO_COURIER), [], false);
  const answered = {
    ...base,
    shopifyId: 'o-answered',
    activity: [makeEntry('call', 'Call', { outcome: 'answered' })],
  };
  const noAnswer = {
    ...base,
    shopifyId: 'o-noanswer',
    activity: [makeEntry('call', 'Call', { outcome: 'noanswer' })],
  };
  const neverCalled = { ...base, shopifyId: 'o-never', activity: [] };
  const readyTagged = {
    ...base,
    shopifyId: 'o-ready',
    tags: ['to_be_shipped', 'oka-ready'],
    activity: [],
  };
  const all = [answered, noAnswer, neverCalled, readyTagged];

  eq('answered detected', callStatus(answered), 'answered');
  eq('no-answer detected', callStatus(noAnswer), 'notanswered');
  eq('never called detected', callStatus(neverCalled), 'notcalled');

  eq('filter: all', applyFilter(all, 'all').length, 4);
  eq('filter: answered', applyFilter(all, 'answered').map((o) => o.shopifyId), ['o-answered']);
  eq('filter: not answered', applyFilter(all, 'notanswered').map((o) => o.shopifyId), ['o-noanswer']);
  eq(
    'filter: not called',
    applyFilter(all, 'notcalled').map((o) => o.shopifyId),
    ['o-never', 'o-ready'],
  );
  eq('filter: ready for pickup uses the tag', applyFilter(all, 'readypickup').map((o) => o.shopifyId), [
    'o-ready',
  ]);

  const withMedia = {
    ...base,
    activity: [
      makeEntry('photo', 'Photo', { mediaUrl: 'https://cdn.shopify.com/a.jpg' }),
      makeEntry('photo', 'Photo without upload'),
      makeEntry('whatsapp', 'WhatsApp sent'),
      makeEntry('call', 'Call', { outcome: 'answered' }),
      makeEntry('scan', 'Loaded on truck'),
    ],
  };
  eq('only uploaded photos are shown', orderPhotos(withMedia).length, 1);
  eq('history is calls + WhatsApp only', contactHistory(withMedia).length, 2);
  eq('history is newest first', contactHistory(withMedia)[0].kind, 'call');
}

section('Money formatting');
eq('rounds to whole EGP', money(674.4), '674');
eq('thousands separator', money(12500), '12,500');
eq('zero', money(0), '0');

async function tokenTests() {
  section('Shopify client credentials token');

  type Call = { url: string; body: string };
  const calls: Call[] = [];
  let clock = 1_000_000;
  let reply: { status: number; body: string } = {
    status: 200,
    body: JSON.stringify({ access_token: 'shpat_first', scope: 'read_orders,write_orders', expires_in: 86399 }),
  };
  const fetcher: TokenFetcher = async (url, init) => {
    calls.push({ url, body: init.body });
    const r = reply;
    return { ok: r.status < 400, status: r.status, text: async () => r.body };
  };
  const src = createTokenSource({
    shopDomain: 'https://756009.myshopify.com/',
    clientId: 'cid',
    clientSecret: 'shpss_x',
    fetcher,
    now: () => clock,
  });

  eq('first call mints a token', await src.get(), 'shpat_first');
  eq('hits the store token endpoint', calls[0]?.url, 'https://756009.myshopify.com/admin/oauth/access_token');
  check('sends grant_type=client_credentials', calls[0]?.body.includes('grant_type=client_credentials'));
  check('sends the client id and secret', calls[0]?.body.includes('client_id=cid') && calls[0]?.body.includes('client_secret=shpss_x'));
  eq('reports granted scopes', src.grantedScope(), 'read_orders,write_orders');

  await src.get();
  eq('cached token is reused', calls.length, 1);

  clock += 23 * 3600 * 1000;
  await src.get();
  eq('still cached at 23h', calls.length, 1);

  reply = { status: 200, body: JSON.stringify({ access_token: 'shpat_second', expires_in: 86399 }) };
  clock += 56 * 60 * 1000; // 23h56m — inside the 5-minute refresh margin
  eq('refreshed before the 24h expiry', await src.get(), 'shpat_second');
  eq('exactly one refresh', calls.length, 2);

  src.invalidate();
  reply = { status: 200, body: JSON.stringify({ access_token: 'shpat_third', expires_in: 86399 }) };
  const [a, b, c] = await Promise.all([src.get(), src.get(), src.get()]);
  check('concurrent callers share one exchange', a === 'shpat_third' && b === a && c === a && calls.length === 3);

  const failing = createTokenSource({
    shopDomain: '756009.myshopify.com',
    clientId: 'cid',
    clientSecret: 'bad',
    fetcher: async () => ({
      ok: false,
      status: 400,
      text: async () => '{"error":"shop_not_permitted","error_description":"Client credentials cannot be performed on this shop."}',
    }),
  });
  try {
    await failing.get();
    check('shop_not_permitted surfaces as an error', false);
  } catch (err) {
    check('shop_not_permitted surfaces as ShopifyTokenError', err instanceof ShopifyTokenError);
    check('error explains the organization requirement', String((err as Error).message).includes('same organization'));
  }

  const unauthorized = createTokenSource({
    shopDomain: '756009.myshopify.com',
    clientId: 'cid',
    clientSecret: 'wrong',
    fetcher: async () => ({ ok: false, status: 401, text: async () => '{"error":"invalid_client"}' }),
  });
  try {
    await unauthorized.get();
  } catch (err) {
    check('bad secret explains where to recopy it', String((err as Error).message).includes('Dev Dashboard'));
  }

  // A failed exchange must not wedge future attempts.
  let attempts = 0;
  const flaky = createTokenSource({
    shopDomain: '756009.myshopify.com',
    clientId: 'cid',
    clientSecret: 's',
    fetcher: async () => {
      attempts++;
      return attempts === 1
        ? { ok: false, status: 503, text: async () => 'unavailable' }
        : { ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'shpat_ok', expires_in: 86399 }) };
    },
  });
  await flaky.get().catch(() => undefined);
  eq('recovers after a failed exchange', await flaky.get(), 'shpat_ok');
}

section('Call recording pickup');
{
  eq('phone key from E.164', phoneKey('+201127064476'), '127064476');
  eq('phone key from local 0-prefixed', phoneKey('01127064476'), '127064476');
  eq('phone key from bare 10 digits', phoneKey('1127064476'), '127064476');
  eq('too-short number gives no key', phoneKey('12345'), '');

  // 14:30:00 Cairo on 23 Sep 2026 (EEST, UTC+3).
  const start = Date.UTC(2026, 8, 23, 11, 30, 0);
  const now = start + 5 * 60_000;
  const rec = (id: string, filename: string, offsetSec: number, durationMs: number | null = 90_000): RecordingCandidate => ({
    id,
    filename,
    creationTime: start + offsetSec * 1000,
    duration: durationMs,
  });

  const samsungThis = rec('a', 'Call recording +201127064476_260923_143012.m4a', 12);
  const samsungOther = rec('b', 'Call recording 01012345678_260923_143100.m4a', 1);
  const older = rec('c', 'Call recording Ahmed_260923_101500.m4a', -4 * 3600);
  eq('number in the filename beats a closer timestamp', pickRecording([samsungOther, samsungThis, older], { phone: '01127064476', startedAt: start, now })?.id, 'a');

  const byName = rec('d', 'Call recording Amr Aly_260923_143005.m4a', 5);
  eq('contact-named file matched on time alone', pickRecording([byName, older], { phone: '+201127064476', startedAt: start, now })?.id, 'd');
  eq('recordings from before the call are ignored', pickRecording([older], { phone: '+201127064476', startedAt: start, now }), null);
  eq('empty recordings are ignored', pickRecording([rec('e', 'x.m4a', 3, 0)], { phone: '', startedAt: start, now }), null);
  eq('future-dated files are ignored', pickRecording([rec('f', 'x.m4a', 3600)], { phone: '', startedAt: start, now }), null);
  eq('a slightly early file still counts (clock skew)', pickRecording([rec('g', 'x.m4a', -60)], { phone: '', startedAt: start, now })?.id, 'g');
  // Samsung saves the file at hang-up (MediaStore modified time), so a voice
  // note that arrives mid-call can sit closer to "Start call" than the recording.
  const voiceNote = rec('h', 'PTT-20260923-WA0003.opus', 20, null);
  const savedContact = rec('i', 'Call recording Amr Aly_260923_143000.m4a', 95, null);
  eq('a call recording beats other audio from the same minutes', pickRecording([voiceNote, savedContact], { phone: '+201127064476', startedAt: start, now })?.id, 'i');
  eq('Arabic recorder names count as call recordings', pickRecording([voiceNote, rec('j', 'تسجيل مكالمة 2026-09-23.m4a', 95)], { phone: '', startedAt: start, now })?.id, 'j');
  eq('any audio still beats nothing', pickRecording([voiceNote], { phone: '+201127064476', startedAt: start, now })?.id, 'h');

  eq('m4a → audio/mp4', audioMimeType('call.m4a'), 'audio/mp4');
  eq('mp3 → audio/mpeg', audioMimeType('call.MP3'), 'audio/mpeg');
  eq('amr → audio/amr', audioMimeType('call.amr'), 'audio/amr');
  eq('unknown extension falls back to reported type', audioMimeType('call.xyz', 'audio/x-foo'), 'audio/x-foo');
  check('Gemini reads m4a and mp3', geminiCanTranscribe('audio/mp4') && geminiCanTranscribe('audio/mpeg'));
  check('Gemini skips AMR and 3GP', !geminiCanTranscribe('audio/amr') && !geminiCanTranscribe('audio/3gpp'));

  eq('Cairo timestamp', cairoStamp(start), '20260923-1430');
  eq('Cairo midnight is 00, not 24', cairoStamp(Date.UTC(2026, 8, 22, 21, 5)), '20260923-0005');
  eq(
    'upload name carries order, AWB, party and time',
    recordingFilename({ orderName: '#2623721', awb: '7433950202', target: 'customer', startedAt: start, originalName: 'Call recording +201127064476_260923_143012.m4a' }),
    'oka-2623721-7433950202-customer-20260923-1430.m4a',
  );
  eq(
    'no AWB yet, original extension kept',
    recordingFilename({ orderName: '#2623721', awb: null, target: 'courier', startedAt: start, originalName: 'rec.MP3' }),
    'oka-2623721-courier-20260923-1430.mp3',
  );
}

section('Gemini transcription');
{
  const ctx = {
    orderName: '#2623621',
    target: 'customer' as const,
    contactName: 'Amr Aly',
    products: ['OKA Cobra + OKA base', 'Tongs , Foil Combo'],
  };
  const prompt = transcriptionPrompt(ctx);
  check('prompt names the order', prompt.includes('#2623621'));
  check('prompt lists the products for spelling', prompt.includes('OKA Cobra + OKA base') && prompt.includes('Tongs , Foil Combo'));
  check('prompt names the customer', prompt.includes('Amr Aly'));
  check('prompt asks for speaker labels', prompt.includes('"OKA:"') && prompt.includes('"Customer:"'));
  check('courier calls label the courier', transcriptionPrompt({ ...ctx, target: 'courier' }).includes('"Courier:"'));

  const req = transcriptionRequest('QUJD', 'audio/mp4', ctx) as any;
  eq('audio sent inline with its type', req.contents[0].parts[0].inlineData, { mimeType: 'audio/mp4', data: 'QUJD' });
  eq('asks for JSON output', req.generationConfig.responseMimeType, 'application/json');
  eq('schema requires summary and transcript', req.generationConfig.responseSchema.required, ['summary', 'transcript']);

  const reply = (text: string, extra: object = {}) => ({ candidates: [{ content: { parts: [{ text }] }, ...extra }] });
  eq(
    'parses structured output',
    parseTranscription(reply('{"summary":"أكد الأوردر","transcript":"OKA: ألو\\nCustomer: أيوه"}')),
    { summary: 'أكد الأوردر', transcript: 'OKA: ألو\nCustomer: أيوه' },
  );
  eq('tolerates a fenced reply', parseTranscription(reply('```json\n{"summary":"s","transcript":"t"}\n```')), { summary: 's', transcript: 't' });
  eq('keeps a prose reply as the transcript', parseTranscription(reply('OKA: ألو')), { summary: '', transcript: 'OKA: ألو' });
  // Verbatim shape of a live gemini-2.5-flash reply: every turn on one line.
  eq(
    'splits speaker turns onto their own lines',
    parseTranscription(reply('{"summary":"s","transcript":"OKA: الو مساء الخير. Customer: ايوه اهلا خير. OKA: تمام."}')).transcript,
    'OKA: الو مساء الخير.\nCustomer: ايوه اهلا خير.\nOKA: تمام.',
  );
  // Second live shape: turns with no separator at all.
  eq(
    'splits turns glued to the previous sentence',
    parseTranscription(reply('{"summary":"s","transcript":"OKA: معاك OKA بخصوص الاوردر.Customer: ايوه.OKA: تمام."}')).transcript,
    'OKA: معاك OKA بخصوص الاوردر.\nCustomer: ايوه.\nOKA: تمام.',
  );
  eq('courier turns split too', parseTranscription(reply('{"summary":"s","transcript":"OKA: فين؟ Courier: جاي"}')).transcript, 'OKA: فين؟\nCourier: جاي');

  try {
    parseTranscription({ promptFeedback: { blockReason: 'SAFETY' } });
    check('a blocked request throws', false);
  } catch (err) {
    check('a blocked request throws TranscriptionError', err instanceof TranscriptionError && String(err).includes('SAFETY'));
  }
  try {
    parseTranscription({ candidates: [{ content: { parts: [] }, finishReason: 'MAX_TOKENS' }] });
    check('an empty reply throws', false);
  } catch (err) {
    check('an empty reply says why', String(err).includes('MAX_TOKENS'));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// J&T Express — shapes captured live on 2026-09-23 via /api/logistics/trace
// and /api/order/getOrders. Structure, codes, hubs and wording are verbatim;
// customer and courier names, phones and addresses are replaced, and photo
// links (signed, and showing customers' signatures) are placeholders.
// ─────────────────────────────────────────────────────────────────────────────

const PIC = 'https://pro-jmseg-file.jtjms-eg.com/example/photo.jpeg';

const JT_PICKUP_SCAN: JtScan = {
  scanTime: '2026-09-21 15:26:58',
  desc: "【المنتزه】【AL-Mandara BR】J&T courier Karim  Nabil Fawzy(01200000010)picked up the shipment. If there is any problem or complaint, please dial branch‘s phone number：000000000|Hassan,035953559|LandLine",
  scanType: 'Pickup scan',
  scanNetworkName: 'AL-Mandara BR',
  scanNetworkProvince: 'الإسكندرية',
  scanNetworkCity: 'المنتزه',
  problemReason: '快件揽收',
  scanTypeCode: 10,
};
const JT_HUB_SCANS: JtScan[] = [
  {
    scanTime: '2026-09-22 00:07:16',
    desc: '【مدينة العاشر من رمضان】Shipment departed from【10thRamadanCityHub】to【BE-Kafr Al-Sheikh DC】',
    scanType: 'Sending scan',
    scanNetworkName: '10thRamadanCityHub',
    scanNetworkCity: 'مدينة العاشر من رمضان',
    nextStopName: 'BE-Kafr Al-Sheikh DC',
    problemReason: '发件扫描',
    scanTypeCode: 50,
  },
  {
    scanTime: '2026-09-21 23:50:22',
    desc: '【مدينة العاشر من رمضان】Shipment arrived at【10thRamadanCityHub】',
    scanType: 'Arrival Scan',
    scanNetworkName: '10thRamadanCityHub',
    scanNetworkCity: 'مدينة العاشر من رمضان',
    nextStopName: 'AL-ABIS DC',
    problemReason: '中心到件',
    scanTypeCode: 92,
  },
  {
    scanTime: '2026-09-21 18:21:32',
    desc: '【محرم بيك】Shipment departed from【AL-ABIS DC】to【10thRamadanCityHub】',
    scanType: 'Sending scan',
    scanNetworkName: 'AL-ABIS DC',
    nextStopName: '10thRamadanCityHub',
    problemReason: '发件扫描',
    scanTypeCode: 50,
  },
];

/** Shape of JEG000541604917: picked up, hubbed, out for delivery, signed. */
const JT_DELIVERED: JtShipment = {
  billCode: 'JEG000541604917',
  order: null,
  dispatches: 1,
  scans: [
    {
      scanTime: '2026-09-22 13:42:44',
      desc: '【كفر الشيخ】【BE-Kafr Al-Sheikh DC】J&T courier Ahmed Samir Hassan(01000000020) completed the delivery.Received by【Signed on receiver】， If there is any problem or complaint, please dial branch‘s phone number：01000000099|Ahmed',
      scanType: 'Signing scan',
      scanNetworkName: 'BE-Kafr Al-Sheikh DC',
      scanNetworkCity: 'كفر الشيخ',
      problemReason: '快件签收',
      sigPicUrl: `${PIC}?sig=1`,
      electronicSignaturePicUrl: `${PIC}?sig=2`,
      otp: '1791',
      scanTypeCode: 100,
    },
    {
      scanTime: '2026-09-22 08:35:43',
      desc: '【كفر الشيخ】【BE-Kafr Al-Sheikh DC】J&T courier Ahmed Samir Hassan(01000000020)is delivering the shipment. If there is any problem or complaint, please dial branch‘s phone number：01000000099|Ahmed',
      scanType: 'Delivery scan',
      scanNetworkName: 'BE-Kafr Al-Sheikh DC',
      scanNetworkCity: 'كفر الشيخ',
      problemReason: '派件扫描',
      scanTypeCode: 94,
    },
    ...JT_HUB_SCANS,
    JT_PICKUP_SCAN,
  ],
};

const JT_PROBLEM_SCAN: JtScan = {
  scanTime: '2026-09-23 14:31:54',
  desc: '【قنا】Fail to Receive，In case of doubt, please contact the J&T courier:01000000030/01000000031',
  scanType: 'Abnormal parcels scan',
  scanNetworkName: 'AS-Qena DC',
  scanNetworkCity: 'قنا',
  problemType: '1004',
  problemReason: '问题件扫描',
  probleDescription: 'Abnormal parcelScan,1004,The goods do not match after opening,العميل لغي الطلب',
  problemPicUrl: `${PIC}?p=1`,
  scanTypeCode: 110,
};
const JT_DELIVERING_QENA: JtScan = {
  scanTime: '2026-09-23 09:44:22',
  desc: '【قنا】【AS-Qena DC】J&T courier Omar Adel Fekry(01000000030)is delivering the shipment. If there is any problem or complaint, please dial branch‘s phone number：01000000031',
  scanType: 'Delivery scan',
  scanNetworkName: 'AS-Qena DC',
  scanNetworkCity: 'قنا',
  problemReason: '派件扫描',
  scanTypeCode: 94,
};

/** Shape of JEG000543585925: out for delivery, then a failed attempt. */
const JT_FAILED: JtShipment = {
  billCode: 'JEG000543585925',
  order: null,
  dispatches: 1,
  scans: [JT_PROBLEM_SCAN, JT_DELIVERING_QENA, ...JT_HUB_SCANS, JT_PICKUP_SCAN],
};

/** Shape of JEG000542940676: a packaging problem, then sent out anyway. */
const JT_PROBLEM_THEN_OUT: JtShipment = {
  billCode: 'JEG000542940676',
  order: null,
  dispatches: 1,
  scans: [
    { ...JT_DELIVERING_QENA, scanTime: '2026-09-23 05:11:07' },
    {
      ...JT_PROBLEM_SCAN,
      scanTime: '2026-09-23 02:29:06',
      problemType: '407',
      probleDescription: 'Abnormal parcelScan,407,Packaging is not standardized,non standar',
      problemPicUrl: `${PIC}?a=1,${PIC}?a=2`,
    },
    ...JT_HUB_SCANS,
    JT_PICKUP_SCAN,
  ],
};

/** getOrders shape for JEG000534521595 — booked, not yet collected. */
const JT_ORDER: JtOrder = {
  customerId: 'J0086011104',
  txlogisticId: 'SHOPIFY2779521',
  billCode: 'JEG000534521595',
  expressType: 'EZ',
  orderType: '2',
  serviceType: '01',
  deliveryType: '04',
  sender: {
    name: 'OKA Egypt',
    mobile: '+20-01025843317',
    prov: 'Alexandria',
    city: 'Montaza 2',
    area: 'Montaza 2',
    street: 'Sidi Beshr Bahri, 11',
  },
  receiver: {
    name: 'محمد علي حسن',
    mobile: '+20-01000000040',
    prov: 'Qalyubia',
    city: 'شبين القناطر',
    area: 'شبين القناطر',
    street: 'شارع المدرسة شبين القناطر قليوبيه',
  },
  createOrderTime: '2026-09-23T08:36:02',
  updateOrderTime: '2026-09-23T08:36:13',
  payType: 'PP_PM',
  goodsType: 'ITN6',
  weight: 0.3,
  totalQuantity: 1,
  itemsValue: 259,
  priceCurrency: 'EGP',
  remark: 'OKA order #2779521; COD 259 EGP',
  sortingCode: '20  C05-03  017',
  orderStatus: 101,
  lastCenterName: '10thRamadanCityHub',
};

const JT_BOOKED: JtShipment = { billCode: 'JEG000534521595', order: JT_ORDER, scans: [], dispatches: null };

section('J&T request signing (matches the J&T connector byte for byte)');
{
  const md5b64 = (s: string) => createHash('md5').update(s, 'utf8').digest('base64');
  const md5hex = (s: string) => createHash('md5').update(s, 'utf8').digest('hex');
  for (const s of ['', 'abc', 'x'.repeat(55), 'y'.repeat(64), 'مرحبا 🚚 {"a":1}']) {
    eq(`md5(${JSON.stringify(s.slice(0, 12))}) matches node:crypto`, toHex(md5(s)), md5hex(s));
  }
  eq('base64 of a digest matches', toBase64(md5('abc')), md5b64('abc'));

  const creds = {
    // Made-up values: only the formula is under test.
    apiAccount: '100000000000000001',
    privateKey: '0123456789abcdef0123456789abcdef',
    customerCode: 'J0000000001',
    customerPassword: 'not-a-real-password',
  };
  // The connector's own formula (jt-mcp-server/src/jtClient.ts), in node:crypto.
  const refBiz = createHash('md5')
    .update(
      creds.customerCode +
        createHash('md5').update(creds.customerPassword + 'jadada236t2').digest('hex').toUpperCase() +
        creds.privateKey,
    )
    .digest('base64');
  eq('business digest', bizDigest(creds), refBiz);

  const req = signedRequest(creds, { command: 2, serialNumber: ['JEG000534521595'] }, true, 1790000000000);
  eq(
    'auth fields lead the bizContent, as the connector sends them',
    req.json,
    JSON.stringify({ customerCode: creds.customerCode, digest: refBiz, command: 2, serialNumber: ['JEG000534521595'] }),
  );
  eq('header digest', req.headers.digest, md5b64(req.json + creds.privateKey));
  eq('apiAccount header', req.headers.apiAccount, creds.apiAccount);
  eq('timestamp header', req.headers.timestamp, '1790000000000');
  eq('form body equals URLSearchParams', req.body, new URLSearchParams({ bizContent: req.json }).toString());
  const tricky = JSON.stringify({ street: "35ش القدس! (بجوار) ~'x' * _-. + & = %", note: 'COD 259 EGP' });
  eq('form encoding of Arabic and punctuation', `bizContent=${formEncode(tricky)}`, new URLSearchParams({ bizContent: tricky }).toString());
  const trace = signedRequest(creds, { billCodes: 'JEG1,JEG2' }, false, 1);
  eq('tracking carries no customer fields', trace.json, '{"billCodes":"JEG1,JEG2"}');
}

section('J&T times are Cairo wall-clock');
{
  eq('September (summer time, UTC+3)', jtTimeToIso('2026-09-22 13:42:44'), '2026-09-22T10:42:44.000Z');
  eq('ISO-style createOrderTime', jtTimeToIso('2026-09-23T08:36:02'), '2026-09-23T05:36:02.000Z');
  eq('January (UTC+2)', jtTimeToIso('2026-01-15 10:00:00'), '2026-01-15T08:00:00.000Z');
  eq('garbage → null', jtTimeToIso('yesterday'), null);
}

section('J&T scans → tracking phase');
{
  eq('delivered parcel → phase 4', jtPhase(JT_DELIVERED), 4);
  eq('failed attempt keeps out-for-delivery', jtPhase(JT_FAILED), 3);
  eq('pickup only → phase 1', jtPhase({ ...JT_BOOKED, scans: [JT_PICKUP_SCAN] }), 1);
  eq('hub scans → phase 2', jtPhase({ ...JT_BOOKED, scans: [...JT_HUB_SCANS, JT_PICKUP_SCAN] }), 2);
  eq('booked, no scans → phase 0', jtPhase(JT_BOOKED), 0);
  eq(
    'order status "picked up" without scans → phase 1',
    jtPhase({ ...JT_BOOKED, order: { ...JT_ORDER, orderStatus: 103 } }),
    1,
  );

  const times = jtPhaseTimes({ ...JT_DELIVERED, order: JT_ORDER });
  eq('created time from the order record', times[0], '2026-09-23T05:36:02.000Z');
  eq('picked-up time is the pickup scan', times[1], '2026-09-21T12:26:58.000Z');
  eq('in-transit time is the first hub scan', times[2], '2026-09-21T15:21:32.000Z');
  eq('out-for-delivery time', times[3], '2026-09-22T05:35:43.000Z');
  eq('delivered time', times[4], '2026-09-22T10:42:44.000Z');

  eq('delivery attempts from numberOfDispatch', jtAttempts(JT_FAILED), 1);
  eq('attempts counted from scans when J&T omits it', jtAttempts({ ...JT_FAILED, dispatches: null }), 1);
  eq('state label is the latest scan', jtStateLabel(JT_DELIVERED), 'Signing scan');
  eq('state label from order status', jtStateLabel(JT_BOOKED), 'Assigned to branch');
}

section('J&T locks, cancellations and returns');
{
  eq('booked, not collected → editable', jtIsLocked(JT_BOOKED), false);
  eq('any scan → locked', jtIsLocked(JT_FAILED), true);
  eq('cancelled order → terminal', jtIsTerminal({ ...JT_BOOKED, order: { ...JT_ORDER, orderStatus: 104 } }), true);
  eq('delivered is not terminal', jtIsTerminal(JT_DELIVERED), false);
  eq(
    'a return scan → terminal',
    jtIsTerminal({ ...JT_FAILED, scans: [{ ...JT_DELIVERING_QENA, scanType: 'Return scan', scanTypeCode: 172 }] }),
    true,
  );
  eq('return scans move no phase', scanPhase({ ...JT_PICKUP_SCAN, problemReason: '退件扫描' }), null);
}

section('J&T courier, branch and problems from the scan text');
{
  eq('delivering courier, not the pickup one', jtCourier(JT_DELIVERED), { name: 'Ahmed Samir Hassan', phone: '01000000020' });
  eq('double spaces in names collapse', courierFromScan(JT_PICKUP_SCAN)?.name, 'Karim Nabil Fawzy');
  eq('no delivery scans → no courier', jtCourier({ ...JT_BOOKED, scans: [JT_PICKUP_SCAN] }), null);
  eq('branch phone', branchPhoneFromScan(JT_DELIVERED.scans[0]), '01000000099');
  eq('zero placeholder numbers skipped', branchPhoneFromScan(JT_PICKUP_SCAN), '035953559');

  const p = jtOpenProblem(JT_FAILED);
  eq('open problem reason', p?.reason, 'The goods do not match after opening');
  eq("courier's note kept", p?.note, 'العميل لغي الطلب');
  eq('problem code', p?.code, '1004');
  eq('problem photo', p?.photos, [`${PIC}?p=1`]);
  eq('problem time', p?.at, '2026-09-23T11:31:54.000Z');
  eq('a problem followed by a delivery scan is closed', jtOpenProblem(JT_PROBLEM_THEN_OUT), null);
  eq(
    'comma-separated problem photos split',
    problemFromScan(JT_PROBLEM_THEN_OUT.scans[1]).photos,
    [`${PIC}?a=1`, `${PIC}?a=2`],
  );

  const ev = jtEvents(JT_DELIVERED);
  eq('events newest first', ev.map((e) => e.kind), ['delivered', 'delivering', 'departed', 'arrived', 'departed', 'pickup']);
  eq('proof-of-delivery photos on the signing event', ev[0].photos, [`${PIC}?sig=1`, `${PIC}?sig=2`]);
  eq('delivery code', ev[0].otp, '1791');
  eq('next stop on departures', ev[2].next, 'BE-Kafr Al-Sheikh DC');
  eq('failed attempt event', jtEvents(JT_FAILED)[0].kind, 'problem');
}

section('Shopify fulfillment → courier');
{
  const withTracking = (list: { status: string; createdAt: string; company: string | null; number: string }[]) =>
    ({
      ...SHOPIFY_ORDER,
      fulfillments: list.map((f) => ({
        status: f.status,
        createdAt: f.createdAt,
        trackingInfo: [{ company: f.company, number: f.number, url: null }],
      })),
    }) as ShopifyOrder;

  eq(
    'J&T Express',
    parcelFromShopify(withTracking([{ status: 'SUCCESS', createdAt: '2026-09-23T06:44:31Z', company: 'J&T Express', number: 'JEG000534521595' }])),
    { carrier: 'jt', awb: 'JEG000534521595' },
  );
  eq(
    'Bosta',
    parcelFromShopify(withTracking([{ status: 'SUCCESS', createdAt: '2026-09-17T06:39:09Z', company: 'Bosta', number: '3948181995' }])),
    { carrier: 'bosta', awb: '3948181995' },
  );
  eq(
    'cancelled fulfillment ignored, newest live one wins',
    parcelFromShopify(
      withTracking([
        { status: 'SUCCESS', createdAt: '2026-09-17T06:39:09Z', company: 'Bosta', number: '3948181995' },
        { status: 'CANCELLED', createdAt: '2026-09-23T06:00:00Z', company: 'J&T Express', number: 'JEG000000000001' },
        { status: 'SUCCESS', createdAt: '2026-09-22T06:00:00Z', company: 'J&T Express', number: 'JEG000534521595' },
      ]),
    ),
    { carrier: 'jt', awb: 'JEG000534521595' },
  );
  eq('no fulfillment → none', parcelFromShopify(SHOPIFY_ORDER), null);
  eq('company missing → J&T by AWB shape', carrierOfTracking(null, 'JEG000534521595'), 'jt');
  eq('company missing → Bosta by AWB shape', carrierOfTracking('', '3948181995'), 'bosta');
  eq('unknown courier → none', carrierOfTracking('Aramex', 'ABC123'), null);
}

section('Shopify × J&T join');
{
  const shipped = { ...JT_DELIVERED, order: { ...JT_ORDER, billCode: 'JEG000541604917', orderStatus: 103 } };
  const o = buildOrder(SHOPIFY_ORDER, jtParcel(shipped), [], false);
  eq('AWB from J&T', o.awb, 'JEG000541604917');
  eq('carrier key', o.carrier, 'jt');
  eq('carrier name', o.carrierName, 'J&T Express');
  eq('COD from J&T itemsValue', o.cod, 259);
  eq('delivered chip', o.status, 'delivered');
  eq('locked once J&T has it', o.locked, true);
  eq('courier from the delivery scan', o.courier?.name, 'Ahmed Samir Hassan');
  eq('J&T record kept for cancel/update', o.jtOrder?.txlogisticId, 'SHOPIFY2779521');
  eq('no Bosta scores', [o.rank, o.clarity, o.bostaId], [null, null, null]);
  eq('scan history carried', o.events.length, JT_DELIVERED.scans.length);

  const booked = buildOrder(SHOPIFY_ORDER, jtParcel(JT_BOOKED), [], true);
  eq('booked → ready chip', booked.status, 'ready');
  eq('booked → still editable', booked.locked, false);
  eq('Arabic city from J&T receiver', booked.city, 'شبين القناطر');
  eq('street from J&T receiver', booked.address, 'شارع المدرسة شبين القناطر قليوبيه');

  const failed = buildOrder(SHOPIFY_ORDER, jtParcel({ ...JT_FAILED, order: JT_ORDER }), [], false);
  eq('failed attempt → transit chip with a problem', [failed.status, failed.problem?.code], ['transit', '1004']);

  const cancelled = buildOrder(SHOPIFY_ORDER, jtParcel({ ...JT_BOOKED, order: { ...JT_ORDER, orderStatus: 104 } }), [], false);
  eq('J&T cancellation → cancelled chip', cancelled.status, 'cancelled');

  const unread = buildOrder(SHOPIFY_ORDER, { carrier: 'jt', awb: 'JEG000534521595', shipment: null }, [], false);
  eq('AWB known from Shopify only → shown, marked booked', [unread.awb, unread.carrierName, unread.stateValue], ['JEG000534521595', 'J&T Express', 'Booked']);

  eq('J&T filter', applyFilter([o, buildOrder(SHOPIFY_ORDER, bostaParcel(BOSTA_NO_COURIER), [], false)], 'jt').length, 1);
  eq('Bosta filter', applyFilter([o, buildOrder(SHOPIFY_ORDER, bostaParcel(BOSTA_NO_COURIER), [], false)], 'bosta')[0].carrier, 'bosta');
}

section('Courier COD vs what Shopify says is owed');
{
  // Shape of #2779321 on 2026-09-23: J&T itemsValue 411, Shopify balance 496.
  const owed496 = {
    ...SHOPIFY_ORDER,
    totalOutstandingSet: { shopMoney: { amount: '496.0', currencyCode: 'EGP' } },
  } as ShopifyOrder;
  const at411 = { ...JT_BOOKED, order: { ...JT_ORDER, itemsValue: 411 } };
  eq('mismatch raised', buildOrder(owed496, jtParcel(at411), [], false).codMismatch, { courier: 411, shopify: 496 });
  eq('COD shown is what the courier collects', buildOrder(owed496, jtParcel(at411), [], false).cod, 411);
  eq(
    'matching amounts → none',
    buildOrder(owed496, jtParcel({ ...JT_BOOKED, order: { ...JT_ORDER, itemsValue: 496 } }), [], false).codMismatch,
    null,
  );
  eq(
    'delivered parcels are left alone',
    buildOrder(owed496, jtParcel({ ...JT_DELIVERED, order: { ...JT_ORDER, itemsValue: 411 } }), [], false).codMismatch,
    null,
  );
  eq('no parcel → none', buildOrder(owed496, null, [], false).codMismatch, null);
  eq(
    'Bosta COD compared too',
    buildOrder(owed496, bostaParcel(BOSTA_NO_COURIER), [], false).codMismatch,
    { courier: 674, shopify: 496 },
  );
}

section('Choosing between couriers');
{
  const liveJt = { ...JT_BOOKED };
  eq('Shopify hint wins', pickParcel({ hint: { carrier: 'jt', awb: 'JEG000534521595' }, bosta: BOSTA_NO_COURIER, jt: liveJt })?.carrier, 'jt');
  eq(
    'hint for another AWB leaves data empty rather than mixing parcels',
    pickParcel({ hint: { carrier: 'jt', awb: 'JEG999' }, bosta: null, jt: liveJt }),
    { carrier: 'jt', awb: 'JEG999', shipment: null },
  );
  const terminatedBosta = { ...BOSTA_NO_COURIER, state: { value: 'Terminated', code: 49 } } as BostaDelivery;
  eq('live parcel beats a terminated one', pickParcel({ hint: null, bosta: terminatedBosta, jt: liveJt })?.carrier, 'jt');
  eq('only Bosta → Bosta', pickParcel({ hint: null, bosta: BOSTA_NO_COURIER, jt: null })?.carrier, 'bosta');
  eq('nothing → null', pickParcel({ hint: null, bosta: null, jt: null }), null);
}

section('J&T updates resubmit the whole order');
{
  const pick = buildPickInfo(
    [
      { name: 'OKA Carbon Black', qty: 1, unitPrice: 189 },
      { name: 'Tongs', qty: 0, unitPrice: 20 },
    ],
    189,
    70,
    259,
  );
  eq('pickInfo format', pick, `OKA Carbon Black x1 @189 EGP; Subtotal: 189 EGP; Shipping: 70 EGP; COD: 259 EGP; ${NO_OPEN_NOTICE}`);
  eq('pickInfo capped at 500', buildPickInfo([{ name: 'x'.repeat(600), qty: 1, unitPrice: 1 }], 1, 0, 1).length, 500);

  const payload = updatePayload(JT_ORDER, '#2779521', { cod: 300, street: 'شارع جديد', pickInfo: pick });
  eq('operateType 2', payload.operateType, 2);
  eq('same txlogisticId', payload.txlogisticId, 'SHOPIFY2779521');
  eq('new COD', payload.itemsValue, 300);
  eq('remark COD rewritten, rest kept', payload.remark, 'OKA order #2779521; COD 300 EGP');
  eq('pay type echoed back', payload.payType, 'PP_PM');
  eq('+20- prefix stripped from sender', (payload.sender as JtParty).mobile, '01025843317');
  eq('+20- prefix stripped from receiver', (payload.receiver as JtParty).mobile, '01000000040');
  eq('country code filled', (payload.receiver as JtParty).countryCode, 'EGY');
  eq('street changed', (payload.receiver as JtParty).street, 'شارع جديد');
  eq('area untouched', (payload.receiver as JtParty).area, 'شبين القناطر');
  eq('weight and goods type resent', [payload.weight, payload.goodsType, payload.expressType, payload.deliveryType], [0.3, 'ITN6', 'EZ', '04']);
  eq('read-only fields not sent', ['orderStatus', 'billCode', 'sortingCode'].filter((k) => k in payload), []);
  eq('remark without a COD gets one', rewriteRemark('Alt phone: 0100', '#1', 50), 'Alt phone: 0100; COD 50 EGP');
  eq('missing remark rebuilt', rewriteRemark(undefined, '#2779521', 259), 'OKA order #2779521; COD 259 EGP');

  eq('cancel payload uses the order type J&T reported', cancelPayload(JT_ORDER, 'x'.repeat(80)), {
    txlogisticId: 'SHOPIFY2779521',
    reason: 'x'.repeat(50),
    orderType: 2,
  });
  eq('reference ↔ order name', [txIdForOrder('#2779521'), orderNameForTxId('SHOPIFY2779521'), orderNameForTxId('OTHER1')], ['SHOPIFY2779521', '#2779521', null]);
  eq('prefix stripper leaves plain numbers', stripJtPhonePrefix('01025843317'), '01025843317');
  eq(
    "J&T's no-match error is recognised as an empty result",
    isEmptyLookupError('999001030', '参数无效:waybillNos size must be between 1 and 1000;'),
    true,
  );
  eq('…also when J&T sends the code as a number', isEmptyLookupError(999001030, 'waybillNos size must be between 1 and 1000'), true);
  eq('other J&T errors still count as errors', isEmptyLookupError('999001030', 'digest is invalid'), false);
}

section('Warehouse photos');
{
  eq('photo ids from the oka.photos field', photoIdsOf({ photos: { value: '["gid://shopify/MediaImage/1","gid://shopify/MediaImage/2"]' } }), [
    'gid://shopify/MediaImage/1',
    'gid://shopify/MediaImage/2',
  ]);
  eq('empty or broken field → none', [photoIdsOf({ photos: null }), photoIdsOf({ photos: { value: 'oops' } })], [[], []]);

  const o = buildOrder(
    { ...SHOPIFY_ORDER, photos: { value: '["gid://shopify/MediaImage/1","gid://shopify/MediaImage/9"]' } } as ShopifyOrder,
    null,
    [
      makeEntry('photo', 'Photo', { mediaUrl: 'https://cdn.shopify.com/a.jpg', meta: { fileId: 'gid://shopify/MediaImage/1' } }),
      makeEntry('photo', 'Photo still processing', { meta: { fileId: 'gid://shopify/MediaImage/5' } }),
    ],
    false,
  );
  const photos = orderPhotos(o);
  eq('logged photo with its link', photos[0], { url: 'https://cdn.shopify.com/a.jpg', at: photos[0].at, fileId: 'gid://shopify/MediaImage/1' });
  eq('logged photo still processing is kept, link to come', [photos[1].url, photos[1].fileId], [null, 'gid://shopify/MediaImage/5']);
  eq('a file only in the field is added once', photos.map((p) => p.fileId), [
    'gid://shopify/MediaImage/1',
    'gid://shopify/MediaImage/5',
    'gid://shopify/MediaImage/9',
  ]);
}

section('In-house delivery');
{
  const loadedAt = '2026-09-24T10:00:00.000Z';
  const deliveredAt = '2026-09-24T13:30:00.000Z';
  const loadEntry = { ...makeEntry('scan', 'Loaded on the in-house delivery truck', { meta: { carrier: 'inhouse' } }), at: loadedAt };
  const doneEntry = {
    ...makeEntry('status', 'Delivered by in-house courier', { meta: { carrier: 'inhouse', delivered: true, deliveryCost: 45 } }),
    at: deliveredAt,
  };

  const out = buildOrder({ ...SHOPIFY_ORDER, tags: [TAG_INHOUSE] } as ShopifyOrder, null, [loadEntry], false);
  eq('tag makes it an in-house delivery', [out.carrier, out.carrierName, out.awb], ['inhouse', 'In-house delivery', null]);
  eq('loaded → out for delivery', [out.trackPhase, out.status, out.locked], [3, 'transit', false]);
  eq('loaded time on the timeline', [out.phaseTimes[1], out.phaseTimes[3], out.phaseTimes[4]], [loadedAt, loadedAt, null]);
  eq('no courier COD to compare', out.codMismatch, null);

  const done = buildOrder(
    { ...SHOPIFY_ORDER, tags: [TAG_INHOUSE, TAG_DELIVERED], deliveryCost: { value: '45.0' } } as ShopifyOrder,
    null,
    [loadEntry, doneEntry],
    false,
  );
  eq('delivered', [done.trackPhase, done.status, done.locked], [4, 'delivered', true]);
  eq('delivered time', done.phaseTimes[4], deliveredAt);
  eq('delivery cost from the order field', done.deliveryCost, 45);
  eq('in-house filter', applyFilter([out, done, buildOrder(SHOPIFY_ORDER, null, [], false)], 'inhouse').length, 2);

  const booked = buildOrder({ ...SHOPIFY_ORDER, tags: [TAG_INHOUSE] } as ShopifyOrder, jtParcel(JT_BOOKED), [], false);
  eq('a courier parcel wins over the in-house tag', booked.carrier, 'jt');
}

section('AWB contents after an edit');
{
  eq(
    'contents line lists what is in the box',
    packageDescription([
      { title: 'OKA Carbon Black', quantity: 1 },
      { title: 'Tongs', quantity: 2 },
      { title: 'Removed line', quantity: 0 },
    ]),
    'OKA Carbon Black x1; Tongs x2',
  );
  eq('long lists are cut to fit', packageDescription([{ title: 'x'.repeat(400), quantity: 1 }]).length, 250);
}

section('Truck loading');
{
  const L = stringsFor('en');
  const jtOrder = buildOrder(SHOPIFY_ORDER, jtParcel(JT_BOOKED), [], false);
  const bostaOrder = buildOrder(SHOPIFY_ORDER, bostaParcel(BOSTA_NO_COURIER), [], false);
  const plain = buildOrder(SHOPIFY_ORDER, null, [], false);
  const inhouse = buildOrder({ ...SHOPIFY_ORDER, tags: [TAG_INHOUSE] } as ShopifyOrder, null, [], false);

  eq('J&T parcel on the J&T truck', truckRefusal(jtOrder, 'jt', L), null);
  eq('Bosta parcel refused on the J&T truck', truckRefusal(bostaOrder, 'jt', L), '#2623621 is booked with Bosta, not J&T Express');
  eq('unbooked order refused on a courier truck', truckRefusal(plain, 'bosta', L), '#2623621 has no Bosta AWB');
  eq('unbooked order on the in-house truck', truckRefusal(plain, 'inhouse', L), null);
  eq('in-house order reloaded on the in-house truck', truckRefusal(inhouse, 'inhouse', L), null);
  eq('J&T parcel not yet picked up → rerouted onto the in-house truck', truckRefusal(jtOrder, 'inhouse', L), null);
  eq('Bosta parcel not yet picked up → accepted too', truckRefusal(bostaOrder, 'inhouse', L), null);
  const jtPicked = buildOrder(SHOPIFY_ORDER, jtParcel({ ...JT_FAILED, order: JT_ORDER }), [], false);
  eq(
    'J&T parcel already picked up → refused',
    truckRefusal(jtPicked, 'inhouse', L),
    "#2623621 was already picked up by J&T Express — it can't go on the in-house truck",
  );
  const bostaPicked = buildOrder(SHOPIFY_ORDER, bostaParcel(BOSTA_WITH_COURIER), [], false);
  eq('Bosta parcel already picked up → refused', truckRefusal(bostaPicked, 'inhouse', L)?.startsWith('#2623621 was already picked up by Bosta'), true);
  const jtUnread = buildOrder(SHOPIFY_ORDER, { carrier: 'jt', awb: 'JEG000534521595', shipment: null }, [], false);
  eq(
    "courier status unknown → refused rather than guessed",
    truckRefusal(jtUnread, 'inhouse', L),
    "Couldn't check with J&T Express whether #2623621 was picked up — try again",
  );
  eq('courier parcel on the in-house truck counts as rerouted', [isRerouted(jtOrder, 'inhouse'), isRerouted(bostaOrder, 'inhouse')], [true, true]);
  eq('not rerouted: in-house order, or a courier truck', [isRerouted(inhouse, 'inhouse'), isRerouted(plain, 'inhouse'), isRerouted(jtOrder, 'jt')], [false, false, false]);
  eq('in-house order refused on a courier truck', truckRefusal(inhouse, 'jt', L), '#2623621 is booked with In-house delivery, not J&T Express');
}


// ─────────────────────────────────────────────────────────────────────────────
// Delivery analytics — fixtures captured live on 28 Sep 2026 (Shopify bulk
// export, J&T getWaybillInfo / trace / getOrders, Bosta search + single
// delivery). Structure verbatim; AWBs, ids, courier names, phones, payout
// amounts and photo links replaced.
// ─────────────────────────────────────────────────────────────────────────────

/** One line of the Shopify bulk export, verbatim. */
const EXPORT_LINE =
  '{"id":"gid:\\/\\/shopify\\/Order\\/1000000000001","name":"#2767521","tags":["to_be_shipped"],"createdAt":"2026-09-20T04:48:55Z","cancelledAt":null,"displayFinancialStatus":"PENDING","paymentGatewayNames":["Cash on Delivery (COD)"],"currentTotalPriceSet":{"shopMoney":{"amount":"259.0"}},"totalReceivedSet":{"shopMoney":{"amount":"0.0"}},"totalRefundedSet":{"shopMoney":{"amount":"0.0"}},"totalOutstandingSet":{"shopMoney":{"amount":"259.0"}},"fulfillments":[{"status":"SUCCESS","createdAt":"2026-09-20T07:01:45Z","trackingInfo":[{"company":"J\\u0026T Express","number":"JEG000500000101"}]}],"shippingAddress":{"city":"القناطر الخيرية","province":"Qalyubia","provinceCode":"KB"},"deliveryCost":null}';

const BASE_ORDER = parseJsonl<AnalyticsOrder>(EXPORT_LINE)[0];

function aOrder(name: string, awb: string | null, over: Partial<AnalyticsOrder> = {}): AnalyticsOrder {
  return {
    ...BASE_ORDER,
    id: `gid://shopify/Order/${name.replace('#', '')}`,
    name,
    fulfillments: awb
      ? [
          {
            status: 'SUCCESS',
            createdAt: '2026-09-20T07:01:45Z',
            trackingInfo: [{ company: /^JEG/.test(awb) ? 'J&T Express' : 'Bosta', number: awb }],
          },
        ]
      : [],
    ...over,
  };
}

const shopMoney = (n: number) => ({ shopMoney: { amount: String(n) } });

/** Returned parcel (isSign 2 on getWaybillInfo), newest scan first as J&T sends them. */
const JT_RETURN_SCANS: JtScan[] = [
  { scanTime: '2026-09-21 16:31:50', scanType: 'Return Sign', scanTypeCode: 111, problemReason: '退件签收', scanNetworkName: 'AL-Mandara BR', desc: '【المنتزه】【AL-Mandara BR】J&T courier Courier A(01000000001) completed the return delivery.' },
  { scanTime: '2026-09-21 11:00:47', scanType: 'Delivery scan', scanTypeCode: 94, problemReason: '派件扫描', scanNetworkName: 'AL-Mandara BR' },
  // Structure verbatim; a problem on the way back to OKA is not a customer failure.
  { scanTime: '2026-09-20 22:00:00', scanType: 'Abnormal parcels scan', scanTypeCode: 110, problemType: '202', problemReason: '问题件扫描', probleDescription: 'Abnormal parcelScan,202,No Answer or Phone Switched Off,العميل لا يرد', scanNetworkName: '10thRamadanCityHub' },
  { scanTime: '2026-09-20 18:16:57', scanType: 'Returned parcel scan', scanTypeCode: 172, problemReason: '退件扫描', scanNetworkName: 'BS-Beni Suef DC' },
  { scanTime: '2026-09-20 15:46:13', scanType: 'Left Over Scan', scanTypeCode: 120, problemReason: '留仓件入仓', scanNetworkName: 'BS-Beni Suef DC' },
  { scanTime: '2026-09-20 15:39:02', scanType: 'Abnormal parcels scan', scanTypeCode: 110, problemType: '1004', problemReason: '问题件扫描', probleDescription: 'Abnormal parcelScan,1004,The goods do not match after opening,الرفض بعد المعاينة', problemPicUrl: 'https://example.com/p1.jpeg', scanNetworkName: 'BS-Beni Suef DC' },
  { scanTime: '2026-09-20 11:01:21', scanType: 'Delivery scan', scanTypeCode: 94, problemReason: '派件扫描', scanNetworkName: 'BS-Beni Suef DC' },
  { scanTime: '2026-09-20 08:48:27', scanType: 'Arrival Scan', scanTypeCode: 92, problemReason: '到件扫描', scanNetworkName: 'BS-Beni Suef DC' },
  { scanTime: '2026-09-19 14:38:43', scanType: 'Pickup scan', scanTypeCode: 10, problemReason: '快件揽收', scanNetworkName: 'AL-Mandara BR' },
];

/** A parcel still out: two tries, one J&T sorting mistake, one reschedule. */
const JT_ACTIVE_SCANS: JtScan[] = [
  { scanTime: '2026-09-28 08:49:43', scanType: 'Delivery scan', scanTypeCode: 94, problemReason: '派件扫描' },
  { scanTime: '2026-09-27 15:59:43', scanType: 'Abnormal parcels scan', scanTypeCode: 110, problemType: '999', probleDescription: 'Abnormal parcelScan,999,Change The Delivery Time,يوم الحد' },
  { scanTime: '2026-09-27 08:37:37', scanType: 'Abnormal parcels scan', scanTypeCode: 110, probleDescription: 'Abnormal parcelScan,998,Three-segment code error,تخص فرع حدائق اكتوبر' },
  { scanTime: '2026-09-26 19:27:10', scanType: 'Pickup scan', scanTypeCode: 10, problemReason: '快件揽收' },
];

/** Bosta: returned to OKA after three failed tries; the fees come from the single-delivery endpoint. */
const BOSTA_RETURNED = {
  _id: 'x1',
  trackingNumber: '6400000001',
  businessReference: '#2761121',
  cod: 0,
  type: { code: 20, value: 'Return to Origin' },
  state: {
    value: 'Returned to business',
    code: 46,
    pickedUpTime: '2026-09-26T06:51:48.997Z',
    exception: [
      { reason: 'The mobile phone is off', code: 17, time: '2026-09-24T15:11:28.065Z', attemptType: 'return' },
      { reason: 'Retry delivery - the customer is not in the address.', code: 1, time: '2026-09-22T13:13:19.470Z', attemptType: 'delivery' },
      { reason: 'Retry delivery - the customer is not in the address.', code: 1, time: '2026-09-21T13:28:15.698Z', attemptType: 'delivery' },
      { reason: 'Postponed - the customer requested postponement for another day.', code: 3, time: '2026-09-20T13:41:04.848Z', attemptType: 'delivery' },
    ],
  },
  dropOffAddress: { city: { _id: 'city-mt', name: 'Matrouh', nameAr: 'مرسي مطروح' } },
  numberOfAttempts: 5,
  createdAt: 'Fri Sep 18 2026 06:27:16 GMT+0000 (Coordinated Universal Time)',
  shipmentFees: 76,
  originalCod: 434,
  wallet: {
    cashCycle: { cod: '0.00', bosta_fees: '86.64', shipping_fees: '76.00', vat: '10.64', deposited_amt: -86.64 },
    cashout: { amount: '1000.00', transaction_date: '2026-09-28T00:00:00.000Z', transaction_id: 'MONCOD00XXX00' },
  },
} as unknown as BostaDelivery;

const BOSTA_DELIVERED_LIST = {
  _id: 'x2',
  trackingNumber: '6600000002',
  businessReference: '#2761621',
  cod: 434,
  type: { code: 10, value: 'Send' },
  state: { value: 'Delivered', code: 45, pickedUpTime: '2026-09-20T08:58:19.203Z' },
  dropOffAddress: { city: { _id: 'city-dt', name: 'Damietta', nameAr: 'دمياط' } },
  numberOfAttempts: 1,
  paymentMethod: 'COD',
  createdAt: 'Fri Sep 18 2026 06:27:31 GMT+0000 (Coordinated Universal Time)',
} as unknown as BostaDelivery;

section('Analytics: names as couriers and customers type them');
{
  eq('Arabic letter variants fold together', normalizeText('الإسكندرية'), normalizeText('الاسكندريه'));
  eq('Arabic-Indic digits', normalizeText('عماره ١٦'), 'عماره 16');
  eq(
    'Bosta city spellings → governorate',
    ['Bani Suif', 'El Kalioubia', 'Behira', 'Kafr Alsheikh', 'Assuit', 'Fayoum', 'Sharqia', 'Matrouh', 'Monufia'].map((n) => governorateOf(null, n)),
    ['BNS', 'KB', 'BH', 'KFS', 'AST', 'FYM', 'SHR', 'MT', 'MNF'],
  );
  eq(
    'J&T receiver.prov in either language → governorate',
    ['الجيزة', 'القاهرة', 'أسيوط', 'بني سويف', 'الإسماعيلية', 'المنوفية', 'Al Sharqia', 'South Sinai', 'محافظة الإسماعيلية'].map((n) => governorateOf(null, n)),
    ['GZ', 'C', 'AST', 'BNS', 'IS', 'MNF', 'SHR', 'JS', 'IS'],
  );
  eq('Shopify provinceCode wins; legacy codes fold in', [governorateOf('ALX', 'Cairo'), governorateOf('EG-GZ'), governorateOf('SU'), governorateOf('HU')], ['ALX', 'GZ', 'GZ', 'C']);
  eq('unknown name → null', governorateOf(null, 'Atlantis'), null);
  eq(
    'area keys drop noise words and a leading governorate',
    [areaKey('مدينة نصر', 'C'), areaKey('القاهرة مدينة نصر', 'C'), areaKey('الجيزه /العمرنيه الشرقيه', 'GZ'), areaKey('Sheikh Zayed', 'GZ')],
    ['نصر', 'نصر', 'العمرنيه الشرقيه', 'sheikh zayed'],
  );
  eq('placeholder or governorate-only city → no area', [areaKey('0'), areaKey('القاهره', 'C'), areaKey('  ')], [null, null, null]);
}

section('Analytics: failure reasons (live J&T and Bosta wording)');
{
  const cases: [string, string][] = [
    ['Customer refuse by call', 'refused'],
    ['Customer refuse by WhatsApp', 'refused'],
    ['The goods do not match after opening', 'refused'],
    ['No Answer or Phone Switched Off', 'no_answer'],
    ['The mobile phone is off', 'no_answer'],
    ['Change The Delivery Time', 'postponed'],
    ['Postponed - the customer requested postponement for another day.', 'postponed'],
    ['Wrong or Undetailed Address Information', 'address'],
    ['Retry delivery - the customer changed the address.', 'address'],
    ['Waiting for data modification - address not clear', 'address'],
    ['Retry delivery - the customer is not in the address.', 'not_home'],
    ['Cancellation - the customer wants to open the shipment.', 'open_package'],
    ['Cancellation - the customer refuses to receive the shipment.', 'refused'],
    ['Three-segment code error', 'courier_error'],
    ['miss-sorting from DC', 'courier_error'],
    ['العميل لا يرد', 'no_answer'],
    ['رفض الاستلام', 'refused'],
    ['تأجيل', 'postponed'],
    ['Other Kind Of Problems', 'other'],
  ];
  eq('each live phrasing lands in its bucket', cases.map(([t]) => reasonKeyOf(t)), cases.map(([, k]) => k));
  eq('code fallback when the text is unknown', reasonKeyOf('???', 'no_answer'), 'no_answer');
}

section('Analytics: J&T parcel outcome');
{
  const info = (isSign: number): JtWaybill => ({ waybillNo: 'JEG1', isSign, totalFreight: 62.7, numberOfDispatch: 1 });
  eq('isSign 1 → delivered', jtOutcome(info(1), [], undefined), 'delivered');
  eq('isSign 2 → returned (failed)', jtOutcome(info(2), [], undefined), 'failed');
  eq('isSign 0 + return scan → failed (on its way back)', jtOutcome(info(0), JT_RETURN_SCANS.slice(3), undefined), 'failed');
  eq('isSign 0 + delivery scans → active', jtOutcome(info(0), JT_ACTIVE_SCANS, undefined), 'active');
  eq('not on getWaybillInfo and no scans → waiting for pickup', jtOutcome(undefined, [], { orderStatus: 101 } as JtOrder), 'waiting');
  eq('cancelled order → cancelled', jtOutcome(undefined, [], { orderStatus: 104 } as JtOrder), 'cancelled');

  const reasons = jtReasons(JT_RETURN_SCANS);
  eq('only problems before the return count', reasons.map((r) => r.key), ['refused']);
  eq('reason text keeps J&T wording and the courier note', reasons[0].text, 'The goods do not match after opening — الرفض بعد المعاينة');
  eq('attempt reasons oldest first', jtReasons(JT_ACTIVE_SCANS).map((r) => r.key), ['courier_error', 'postponed']);
  const noteOnly = jtReasons([{ scanTime: '2026-09-27 15:59:43', scanTypeCode: 110, probleDescription: 'Abnormal parcelScan,997,Other Kind Of Problems,العميل لا يرد' }]);
  eq("the courier's note decides when J&T's reason is generic", noteOnly[0].key, 'no_answer');
  const reasonWins = jtReasons([{ scanTime: '2026-09-27 15:59:43', scanTypeCode: 110, probleDescription: 'Abnormal parcelScan,203,Wrong or Undetailed Address Information,لايرد' }]);
  eq("J&T's own reason beats the courier's note", reasonWins[0].key, 'address');
}

section('Analytics: Bosta parcel outcome, reasons and fees');
{
  eq('delivered (45, Send)', bostaOutcome(BOSTA_DELIVERED_LIST), 'delivered');
  eq('returned to business (46, Return to Origin)', bostaOutcome(BOSTA_RETURNED), 'failed');
  eq('on its way back (RTO type, still moving) → failed', bostaOutcome({ ...BOSTA_RETURNED, state: { value: 'Out for delivery', code: 41 } } as BostaDelivery), 'failed');
  eq('pickup requested → waiting', bostaOutcome({ ...BOSTA_DELIVERED_LIST, state: { value: 'Pickup requested', code: 10 } } as BostaDelivery), 'waiting');
  eq('received at warehouse → active', bostaOutcome({ ...BOSTA_DELIVERED_LIST, state: { value: 'Received at warehouse', code: 24 } } as BostaDelivery), 'active');
  eq('terminated before pickup → cancelled', bostaOutcome({ ...BOSTA_DELIVERED_LIST, state: { value: 'Terminated', code: 48 } } as BostaDelivery), 'cancelled');
  eq('lost → failed', bostaOutcome({ ...BOSTA_DELIVERED_LIST, state: { value: 'Lost', code: 100 } } as BostaDelivery), 'failed');
  const r = bostaReasons(BOSTA_RETURNED);
  eq('return-trip exceptions excluded, oldest first', r.map((x) => x.key), ['postponed', 'not_home', 'not_home']);
  eq('settled fee (with VAT) from the wallet', bostaFee(BOSTA_RETURNED), 86.64);
  eq('fee + 14% VAT when only shipmentFees is known', bostaFee({ ...BOSTA_DELIVERED_LIST, shipmentFees: 76 } as BostaDelivery), 86.64);
  eq('no fee on the list endpoint', bostaFee(BOSTA_DELIVERED_LIST), null);
}

section('Analytics: one fact per order');
{
  const data = emptyCourierData();
  data.jt.read = true;
  data.jt.waybills.set('JEG000500000101', { waybillNo: 'JEG000500000101', isSign: 2, totalFreight: 52.67, numberOfDispatch: 1 });
  data.jt.scans.set('JEG000500000101', JT_RETURN_SCANS);
  data.jt.waybills.set('JEG000500000102', { waybillNo: 'JEG000500000102', isSign: 1, totalFreight: 66.46, numberOfDispatch: 1 });
  // J&T collects what it was booked for, which can differ from Shopify's figure.
  data.jt.orders.set('JEG000500000102', { billCode: 'JEG000500000102', txlogisticId: 'SHOPIFY2767321', itemsValue: 411 } as JtOrder);
  data.bosta.read = true;
  data.bosta.deliveries.set('6400000001', BOSTA_RETURNED);
  data.bosta.deliveries.set('6600000002', BOSTA_DELIVERED_LIST);

  const failedJt = factFor(BASE_ORDER, data);
  eq('J&T returned parcel', [failedJt.carrier, failedJt.outcome, failedJt.gov, failedJt.fee, failedJt.reason?.key, failedJt.collected], ['jt', 'failed', 'KB', 52.67, 'refused', 0]);
  const deliveredJt = factFor(aOrder('#2767321', 'JEG000500000102', { currentTotalPriceSet: shopMoney(496), totalOutstandingSet: shopMoney(496) }), data);
  eq('J&T delivered: cash is what J&T collected', [deliveredJt.outcome, deliveredJt.collected, deliveredJt.collectedFromCourier], ['delivered', 411, true]);
  data.jt.orders.delete('JEG000500000102');
  const noJtOrder = factFor(aOrder('#2767321', 'JEG000500000102', { totalOutstandingSet: shopMoney(487) }), data);
  eq("…or Shopify's balance when J&T's record isn't loaded", [noJtOrder.collected, noJtOrder.collectedFromCourier], [487, false]);

  const bostaFailed = factFor(aOrder('#2761121', '6400000001', { shippingAddress: null }), data);
  eq('Bosta returned: governorate from Bosta, settled fee', [bostaFailed.outcome, bostaFailed.gov, bostaFailed.fee, bostaFailed.attempts, bostaFailed.reason?.key], ['failed', 'MT', 86.64, 5, 'not_home']);
  const bostaDelivered = factFor(aOrder('#2761621', '6600000002'), data);
  eq('Bosta delivered: COD from Bosta, fee unknown until read', [bostaDelivered.collected, bostaDelivered.fee], [434, null]);

  const inhouse = factFor(
    aOrder('#2800021', null, {
      tags: ['oka-inhouse', 'oka-delivered'],
      displayFinancialStatus: 'PAID',
      totalReceivedSet: shopMoney(259),
      totalOutstandingSet: shopMoney(0),
      deliveryCost: { value: '45.0' },
    }),
    data,
  );
  eq('in-house delivered: driver cash + delivery cost', [inhouse.carrier, inhouse.outcome, inhouse.collected, inhouse.fee], ['inhouse', 'delivered', 259, 45]);
  const rerouted = factFor(aOrder('#2800121', 'JEG000599999999', { tags: ['oka-inhouse'] }), data);
  eq('J&T never picked it up, OKA truck took it → in-house', [rerouted.carrier, rerouted.outcome], ['inhouse', 'active']);
  const prepaid = factFor(
    aOrder('#2800221', null, { paymentGatewayNames: ['Paymob'], displayFinancialStatus: 'PAID', totalReceivedSet: shopMoney(700), totalOutstandingSet: shopMoney(0) }),
    data,
  );
  eq('paid online, not shipped yet', [isCodOrder(prepaid as unknown as AnalyticsOrder), prepaid.cod, prepaid.online, prepaid.carrier, prepaid.outcome], [false, false, 700, null, 'waiting']);
  const unread = factFor(BASE_ORDER, emptyCourierData());
  eq('courier not readable → unknown, never guessed', unread.outcome, 'unknown');
}

section('Analytics: report');
{
  const f = (over: Partial<ShipmentFact>): ShipmentFact => ({
    orderId: 'o',
    order: '#1',
    createdAt: '2026-09-20T10:00:00Z',
    carrier: 'jt',
    awb: 'JEG1',
    outcome: 'delivered',
    gov: 'C',
    area: null,
    areaLabel: null,
    attempts: 1,
    reason: null,
    attemptReasons: [],
    value: 300,
    cod: true,
    collected: 300,
    collectedFromCourier: true,
    online: 0,
    refunded: 0,
    fee: 60,
    ...over,
  });
  const facts: ShipmentFact[] = [
    f({ order: '#1' }),
    f({ order: '#2', attempts: 2 }),
    f({ order: '#3', outcome: 'failed', collected: 0, fee: 50, gov: 'KB', reason: { key: 'refused', text: 'Customer refuse by call' }, attemptReasons: [{ key: 'refused', text: 'Customer refuse by call' }] }),
    f({ order: '#4', outcome: 'failed', collected: 0, fee: 40, gov: 'C', reason: { key: 'no_answer', text: 'No Answer' } }),
    f({ order: '#5', outcome: 'active', collected: 0, value: 250 }),
    f({ order: '#6', outcome: 'waiting', collected: 0, fee: null, createdAt: '2026-09-20T10:00:00Z' }),
    f({ order: '#7', carrier: 'bosta', awb: '123', outcome: 'failed', collected: 0, fee: null, gov: 'GZ', reason: { key: 'refused', text: 'refuses' } }),
    f({ order: '#8', carrier: 'bosta', awb: '124', outcome: 'delivered', collected: 434, fee: 86.64, gov: 'GZ' }),
    f({ order: '#9', carrier: 'inhouse', awb: null, outcome: 'delivered', collected: 259, fee: 45, gov: 'ALX' }),
    f({ order: '#10', carrier: null, awb: null, outcome: 'waiting', collected: 0, fee: null, online: 700, cod: false }),
    f({ order: '#11', carrier: null, awb: null, outcome: 'cancelled', collected: 0, fee: null, refunded: 120, cod: false }),
  ];
  const r = summarize(facts, { from: '2026-09-20', to: '2026-09-21', now: new Date('2026-09-28T12:00:00Z') });
  eq('counts', [r.orders, r.totals.shipments, r.notShipped, r.cancelledOrders], [11, 9, 1, 1]);
  eq('rates over finished parcels', [r.totals.closed, r.totals.delivered, r.totals.failed, r.totals.deliveryRate, r.totals.failureRate], [7, 4, 3, 4 / 7, 3 / 7]);
  eq('first-attempt rate', r.totals.firstAttemptRate, 3 / 4);
  eq('stale: booked over 3 days ago, never picked up', [r.stale.count, r.stale.orders], [1, ['#6']]);
  eq('reasons ranked by count', r.reasons.map((x) => [x.key, x.count]), [['refused', 2], ['no_answer', 1]]);
  // Bosta's unknown fee on #7 is estimated at Bosta's average (86.64).
  eq('failed cost with an estimate', [r.failed.count, r.failed.cost, r.failed.estimated, r.failed.uncollected], [3, 176.64, 86.64, 900]);
  eq('money in', r.money.in, { jt: 600, bosta: 434, inhouse: 259, online: 700, total: 1993 });
  // J&T charges on every parcel it picked up, the active one (#5) included.
  eq('money out', r.money.out, { jt: 270, bosta: 173.28, inhouse: 45, refunds: 120, total: 608.28 });
  eq('balance and cash on the road', [r.money.balance, r.money.onTheRoad, r.money.estimated], [1384.72, 250, 86.64]);
  const jt = r.carriers.find((c) => c.carrier === 'jt')!;
  eq('per courier: collected, fees, net due', [jt.collected, jt.fees, jt.net, jt.failedCost], [600, 270, 330, 90]);
  eq('worst governorates first; places with no returns last', r.governorates.map((g) => g.key), ['KB', 'GZ', 'C', 'ALX']);
}

section('Analytics: periods and the Shopify export query');
{
  const now = new Date(2026, 8, 28, 15, 30);
  const w = periodRange('7d', now);
  eq('7 days = today and the 6 before, to midnight tonight', [w.from.getDate(), w.to.getDate(), (w.to.getTime() - w.from.getTime()) / 86_400_000], [22, 29, 7]);
  const lm = periodRange('lastMonth', now);
  eq('last month', [lm.from.getMonth(), lm.from.getDate(), lm.to.getMonth(), lm.to.getDate()], [7, 1, 8, 1]);
  const q = exportQuery(new Date('2026-09-20T00:00:00Z'), new Date('2026-09-21T00:00:00Z'));
  eq('full timestamps in the search (a bare date compares by day)', q.includes(`created_at:>='2026-09-20T00:00:00.000Z' AND created_at:<'2026-09-21T00:00:00.000Z'`), true);
  eq('export query reads only read_orders fields', /customer|lineItems|fulfillmentOrders/.test(q), false);
  eq('JSONL parse skips blank lines', parseJsonl<{ a: number }>('{"a":1}\n\n{"a":2}\n').map((x) => x.a), [1, 2]);
}

async function analyticsLoaderTests() {
  section('Analytics: loader batching against fake APIs');
  const orders = [
    aOrder('#1', 'JEG000000000001'),
    aOrder('#2', 'JEG000000000002'),
    aOrder('#3', 'JEG000000000003'),
    aOrder('#4', '6400000001'),
    aOrder('#5', null, { createdAt: '2026-09-25T00:00:00Z' }), // outside the period
  ];
  const calls: string[] = [];
  const sources: AnalyticsSources = {
    shopify: async <T,>(query: string) => {
      calls.push(query.includes('bulkOperationRunQuery') ? 'shopify:run' : 'shopify:poll');
      return (query.includes('bulkOperationRunQuery')
        ? { bulkOperationRunQuery: { bulkOperation: { id: 'gid://shopify/BulkOperation/1', status: 'CREATED' }, userErrors: [] } }
        : { node: { id: 'gid://shopify/BulkOperation/1', status: calls.filter((c) => c === 'shopify:poll').length < 2 ? 'RUNNING' : 'COMPLETED', errorCode: null, objectCount: '5', url: 'https://storage.example/x.jsonl', partialDataUrl: null } }) as T;
    },
    download: async () => orders.map((o) => JSON.stringify(o)).join('\n'),
    jt: {
      customerCode: 'J0000000000',
      call: async <T,>(path: string, biz: Record<string, unknown>) => {
        calls.push(`jt:${path.split('/').pop()}:${JSON.stringify(biz.waybillNos ?? biz.billCodes ?? biz.serialNumber)}`);
        if (path.endsWith('getWaybillInfo')) {
          return [
            { waybillNo: 'JEG000000000001', isSign: 1, totalFreight: 62.7, numberOfDispatch: 1 },
            { waybillNo: 'JEG000000000002', isSign: 2, totalFreight: 43.89, numberOfDispatch: 2 },
          ] as T;
        }
        if (path.endsWith('trace')) return [{ billCode: 'JEG000000000002', details: JT_RETURN_SCANS }] as T;
        // J&T answers "nothing found" with this error, not [].
        throw new Error('J&T 999001030: 参数无效:waybillNos size must be between 1 and 1000;');
      },
    },
    bosta: async <T,>(method: string, path: string) => {
      calls.push(`bosta:${method} ${path}`);
      if (path === '/deliveries/search') return { deliveries: [{ ...BOSTA_RETURNED, wallet: undefined, shipmentFees: undefined }] } as T;
      return BOSTA_RETURNED as T;
    },
  };
  const cache = new Map<string, BostaDelivery>();
  const res = await loadAnalytics(sources, {
    from: new Date('2026-09-20T00:00:00Z'),
    to: new Date('2026-09-21T00:00:00Z'),
    bostaCache: cache,
    wait: async () => undefined,
  });
  eq('export polled until complete; out-of-period rows dropped', [calls.filter((c) => c.startsWith('shopify')).length, res.report.orders], [3, 4]);
  eq(
    'J&T: one waybill call for all, trace only the unsigned, orders only the signed',
    calls.filter((c) => c.startsWith('jt:')),
    [
      'jt:getWaybillInfo:["JEG000000000001","JEG000000000002","JEG000000000003"]',
      'jt:trace:"JEG000000000002,JEG000000000003"',
      'jt:getOrders:["JEG000000000001"]',
    ],
  );
  eq("J&T's no-results error isn't a warning", res.warnings, []);
  eq('outcomes', res.facts.map((x) => x.outcome), ['delivered', 'failed', 'waiting', 'failed']);
  eq('Bosta: list, then the single delivery for fees', calls.filter((c) => c.startsWith('bosta:')), ['bosta:POST /deliveries/search', 'bosta:GET /deliveries/business/6400000001']);
  eq('finished Bosta parcels cached', [...cache.keys()], ['6400000001']);
  eq('fees in the report', [res.report.money.out.jt, res.report.money.out.bosta], [106.59, 86.64]);

  calls.length = 0;
  await loadAnalytics(sources, { from: new Date('2026-09-20T00:00:00Z'), to: new Date('2026-09-21T00:00:00Z'), bostaCache: cache, wait: async () => undefined });
  eq('second load reuses the cache', calls.filter((c) => c.startsWith('bosta:GET')).length, 0);

  const broken: AnalyticsSources = { ...sources, jt: { customerCode: 'J0', call: async () => { throw new Error('HTTP 0'); } }, bosta: null };
  const res2 = await loadAnalytics(broken, { from: new Date('2026-09-20T00:00:00Z'), to: new Date('2026-09-21T00:00:00Z'), wait: async () => undefined });
  eq('J&T down → parcels unknown and a warning, not a crash', [res2.facts.slice(0, 3).map((x) => x.outcome), res2.warnings.length > 0], [['unknown', 'unknown', 'unknown'], true]);
}

tokenTests()
  .then(analyticsLoaderTests)
  .then(() => {
  console.log(
    `\n\x1b[1m${failed === 0 ? '\x1b[32mAll green' : '\x1b[31mFailures'}\x1b[0m — ${passed} passed, ${failed} failed\n`,
  );
  process.exit(failed === 0 ? 0 : 1);
});
