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

import { buildOrder, money, normalizePhone, waNumber } from '../src/api/model';
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
import { applyFilter, callStatus, contactHistory, orderPhotos } from '../src/state/selectors';
import type { ShopifyOrder } from '../src/api/shopify';

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
  const o = buildOrder(SHOPIFY_ORDER, withTimeline, [], false);
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
  const o = buildOrder(SHOPIFY_ORDER, BOSTA_NO_COURIER, [], false);
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

  const ar = buildOrder(SHOPIFY_ORDER, BOSTA_NO_COURIER, [], true);
  eq('city (AR) from Bosta', ar.city, 'الدقهليه');
}

{
  const o = buildOrder(SHOPIFY_ORDER, BOSTA_WITH_COURIER, [], false);
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
  eq('isBadAddress → badaddr chip', buildOrder(SHOPIFY_ORDER, badAddr, [], false).status, 'badaddr');

  const lowClarity = {
    ...BOSTA_NO_COURIER,
    dropOffAddress: { ...BOSTA_NO_COURIER.dropOffAddress, addressClarityScore: 34 },
  } as BostaDelivery;
  eq(
    'clarity under 40 → badaddr chip',
    buildOrder(SHOPIFY_ORDER, lowClarity, [], false).status,
    'badaddr',
  );

  const cancelled = { ...SHOPIFY_ORDER, cancelledAt: '2026-08-12T22:00:00Z' } as ShopifyOrder;
  eq(
    'Shopify cancellation wins',
    buildOrder(cancelled, BOSTA_WITH_COURIER, [], false).status,
    'cancelled',
  );

  const terminated = {
    ...BOSTA_WITH_COURIER,
    state: { value: 'Terminated', code: 49 },
  } as BostaDelivery;
  eq(
    'Bosta termination → cancelled chip',
    buildOrder(SHOPIFY_ORDER, terminated, [], false).status,
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
  const base = buildOrder(SHOPIFY_ORDER, BOSTA_NO_COURIER, [], false);
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

console.log(
  `\n\x1b[1m${failed === 0 ? '\x1b[32mAll green' : '\x1b[31mFailures'}\x1b[0m — ${passed} passed, ${failed} failed\n`,
);
process.exit(failed === 0 ? 0 : 1);
