#!/usr/bin/env node
/**
 * Live end-to-end check against the real Shopify, Bosta and J&T accounts.
 *
 * Reads .env, then exercises every API path the app depends on — reads first,
 * and the write paths only when you pass --write. Run it once after filling in
 * .env to confirm the credentials and scopes are right before handing phones to
 * the warehouse.
 *
 *   npm run verify            # read-only
 *   npm run verify -- --write # also writes a log entry to one real order
 */

import { jtCall, jtConfig, loadEnv } from './live-common.mjs';

const WRITE = process.argv.includes('--write');

// ── .env ─────────────────────────────────────────────────────────────────────
// Parsed the way Expo parses it for the app (see live-common.mjs).
const loaded = loadEnv();
if (!loaded) {
  fail('No .env file found. Copy .env.example to .env and fill in your keys.');
  process.exit(1);
}
const { env, cutAtHash } = loaded;

const SHOP = (env.SHOPIFY_STORE_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
const CLIENT_ID = env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = env.SHOPIFY_CLIENT_SECRET;
const STATIC_TOKEN = env.SHOPIFY_ADMIN_ACCESS_TOKEN;
let TOKEN = STATIC_TOKEN;
const VERSION = env.SHOPIFY_API_VERSION || '2026-07';
const BOSTA_KEY = env.BOSTA_API_KEY;
const BOSTA_URL = (env.BOSTA_BASE_URL || 'https://app.bosta.co/api/v2').replace(/\/$/, '');
const { jt: JT, ready: JT_READY } = jtConfig(env);
const GEMINI_KEY = env.GEMINI_API_KEY;
const GEMINI_MODEL = env.GEMINI_AUDIO_MODEL || 'gemini-2.5-flash';

let failures = 0;
function ok(msg, extra = '') {
  console.log(`  \x1b[32m✓\x1b[0m ${msg}${extra ? ` \x1b[2m${extra}\x1b[0m` : ''}`);
}
function fail(msg, extra = '') {
  failures++;
  console.log(`  \x1b[31m✗\x1b[0m ${msg}${extra ? `\n      ${extra}` : ''}`);
}
function section(t) {
  console.log(`\n\x1b[1m${t}\x1b[0m`);
}

async function shopify(query, variables = {}) {
  const res = await fetch(`https://${SHOP}/admin/api/${VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  if (body.errors) throw new Error(body.errors.map((e) => e.message).join('; '));
  return body.data;
}

async function bosta(method, path, payload) {
  const res = await fetch(`${BOSTA_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: BOSTA_KEY },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  const json = JSON.parse(text);
  return json.data ?? json;
}

const jt = (path, bizContent, withAuth) => jtCall(JT, path, bizContent, withAuth);

/** Courier and AWB from the Shopify fulfillment, as the app reads them. */
function trackingOf(order) {
  for (const f of order.fulfillments ?? []) {
    if (/cancel|error|fail/i.test(f.status ?? '')) continue;
    for (const t of f.trackingInfo ?? []) {
      const c = (t.company ?? '').toLowerCase();
      if (/j\s*&\s*t/.test(c) || /^JEG\d+$/i.test(t.number ?? '')) return { carrier: 'jt', awb: t.number };
      if (c.includes('bosta') || /^\d{6,12}$/.test(t.number ?? '')) return { carrier: 'bosta', awb: t.number };
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────

section('Configuration');
for (const key of cutAtHash) {
  fail(
    `${key} contains # without quotes — the app only sees the part before it`,
    `Wrap it in double quotes in .env: ${key}="…"`,
  );
}
SHOP ? ok('SHOPIFY_STORE_DOMAIN set', SHOP) : fail('SHOPIFY_STORE_DOMAIN missing');
if (STATIC_TOKEN) {
  ok('SHOPIFY_ADMIN_ACCESS_TOKEN set', 'permanent token');
} else if (CLIENT_ID && CLIENT_SECRET) {
  ok('SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET set', 'client credentials grant');
} else {
  fail('Shopify credentials missing', 'Set SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET from the Dev Dashboard.');
}
BOSTA_KEY
  ? ok('BOSTA_API_KEY set')
  : console.log('  \x1b[2m– BOSTA_API_KEY not set — Bosta parcels show without live status\x1b[0m');
JT_READY
  ? ok('J&T credentials set', `${JT.apiAccount} · ${JT.customerCode} · ${JT.baseUrl}`)
  : console.log(
      '  \x1b[2m– J&T not set (JT_API_ACCOUNT, JT_PRIVATE_KEY, JT_CUSTOMER_CODE, JT_CUSTOMER_PASSWORD) — J&T parcels show without live status\x1b[0m',
    );
if (!BOSTA_KEY && !JT_READY) fail('no courier configured', 'Set BOSTA_API_KEY and/or the four JT_* values.');
if (!SHOP || (!(CLIENT_ID && CLIENT_SECRET) && !STATIC_TOKEN)) {
  console.log('\nFill in the Shopify values in .env before re-running.\n');
  process.exit(1);
}

if (!STATIC_TOKEN && CLIENT_ID && CLIENT_SECRET) {
  section('Shopify token exchange');
  try {
    const res = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }).toString(),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    const d = JSON.parse(text);
    TOKEN = d.access_token;
    ok('client credentials exchanged for an access token', `expires in ${Math.round((d.expires_in ?? 0) / 3600)}h`);

    const granted = new Set(String(d.scope ?? '').split(',').map((x) => x.trim()).filter(Boolean));
    const has = (s) => granted.has(s) || granted.has(s.replace(/^read_/, 'write_'));
    const needed = ['read_orders', 'write_orders', 'read_order_edits', 'write_order_edits', 'read_products', 'read_customers', 'read_files', 'write_files'];
    const missing = needed.filter((s) => !has(s));
    missing.length
      ? fail('scopes missing on the app version', `${missing.join(', ')} — add them in the Dev Dashboard, release a new version, and approve it on the store`)
      : ok('all required scopes granted');
  } catch (e) {
    const m = String(e.message);
    const hint = m.includes('shop_not_permitted')
      ? 'The app and the store must be in the same Dev Dashboard organization.'
      : m.includes('invalid_client')
        ? 'Client ID or Client secret is wrong — recopy both from Dev Dashboard → app → Settings.'
        : m.includes('not installed') || m.includes('app_not_installed')
          ? 'Install the app on the store from the Dev Dashboard first.'
          : '';
    fail('token exchange failed', hint ? `${m}\n      ${hint}` : m);
    console.log('\nFix the problem above before re-running.\n');
    process.exit(1);
  }
}

let orders = [];
let deliveries = [];

section('Shopify Admin API');
try {
  const d = await shopify('{ shop { name currencyCode ianaTimezone } }');
  ok('authenticated', `${d.shop.name} · ${d.shop.currencyCode} · ${d.shop.ianaTimezone}`);
} catch (e) {
  fail('authentication failed', e.message);
}

try {
  const d = await shopify(
    `query { orders(first: 25, query: "status:open", sortKey: CREATED_AT, reverse: true) {
       nodes {
         id name createdAt tags
         currentTotalPriceSet { shopMoney { amount } }
         shippingAddress { name phone city }
         fulfillments(first: 5) { status createdAt trackingInfo(first: 3) { company number } }
         lineItems(first: 5) { nodes { title quantity image { url } } }
         metafield(namespace: "oka", key: "activity_log") { value }
       }
     } }`,
  );
  orders = d.orders.nodes;
  ok(`read_orders scope`, `${orders.length} open orders`);
  const withImages = orders.filter((o) => o.lineItems.nodes.some((l) => l.image?.url)).length;
  ok('line-item images present', `${withImages}/${orders.length} orders`);
} catch (e) {
  fail('reading orders failed — check the read_orders scope', e.message);
}

try {
  const d = await shopify('{ products(first: 5, query: "status:active") { nodes { id title } } }');
  ok('read_products scope', `${d.products.nodes.length} products`);
} catch (e) {
  fail('reading products failed — check the read_products scope', e.message);
}

try {
  await shopify(
    `mutation { stagedUploadsCreate(input: [{filename: "probe.png", mimeType: "image/png", resource: IMAGE, httpMethod: POST}]) {
       stagedTargets { url } userErrors { field message } } }`,
  );
  ok('write_files scope', 'photo and call-recording uploads will work');
} catch (e) {
  fail('staged uploads failed — check the write_files scope', e.message);
}

section('Bosta API');
if (!BOSTA_KEY) {
  console.log('  \x1b[2mskipped — BOSTA_API_KEY not set\x1b[0m');
} else try {
  deliveries = (await bosta('POST', '/deliveries/search', { limit: 100, pageId: 1, page: 1 }))
    .deliveries ?? [];
  ok('authenticated', `${deliveries.length} recent deliveries`);
} catch (e) {
  fail('authentication failed — check BOSTA_API_KEY', e.message);
}

if (deliveries.length) {
  const awb = deliveries[0].trackingNumber;
  try {
    const d = await bosta('GET', `/deliveries/business/${awb}`);
    ok('single-delivery read', `AWB ${awb} · ${d.state?.value}`);
    if (Array.isArray(d.timeline) && d.timeline.length) {
      const done = d.timeline.filter((t) => t.done).length;
      ok('tracking timeline available', `${done}/${d.timeline.length} phases done`);
    } else {
      fail('no timeline on the delivery — the tracking screen will show no timestamps');
    }
  } catch (e) {
    fail(`reading AWB ${awb} failed`, e.message);
  }
}

section('J&T Express API');
const jtShipped = orders.map((o) => ({ o, t: trackingOf(o) })).filter((x) => x.t?.carrier === 'jt');
if (!JT_READY) {
  console.log('  \x1b[2mskipped — J&T credentials not set\x1b[0m');
} else {
  const sample = jtShipped.slice(0, 10).map((x) => x.t.awb);
  try {
    const found = await jt('/api/order/getOrders', { command: 1, serialNumber: orders.slice(0, 20).map((o) => `SHOPIFY${o.name.replace(/^#/, '')}`) }, true);
    ok('authenticated (order query)', `${found.length} of ${Math.min(orders.length, 20)} recent orders booked with J&T under SHOPIFY<n>`);
  } catch (e) {
    fail('J&T order query failed — check JT_API_ACCOUNT, JT_PRIVATE_KEY, JT_CUSTOMER_CODE and JT_CUSTOMER_PASSWORD', e.message);
  }
  if (sample.length === 0) {
    console.log('  \x1b[2m– no open order has a J&T tracking number on its fulfillment yet\x1b[0m');
  } else {
    try {
      const traces = await jt('/api/logistics/trace', { billCodes: sample.join(',') }, false);
      const scanned = traces.filter((t) => (t.details ?? []).length > 0);
      ok('tracking read', `${scanned.length}/${sample.length} AWBs have scans`);
      const t = scanned[0];
      if (t) ok('sample', `${t.billCode} · ${t.details[0].scanType} · ${t.details[0].scanTime} (Cairo)`);
    } catch (e) {
      fail('J&T tracking failed', e.message);
    }
  }
}

section('Gemini (call transcription)');
if (!GEMINI_KEY) {
  console.log('  \x1b[2mskipped — GEMINI_API_KEY not set; recordings will upload without transcripts\x1b[0m');
} else {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}`, {
      headers: { 'x-goog-api-key': GEMINI_KEY },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.error?.message ?? JSON.stringify(body).slice(0, 200)}`);
    const audio = (body.supportedGenerationMethods ?? []).includes('generateContent');
    audio
      ? ok('API key valid and model available', `${body.displayName ?? GEMINI_MODEL}`)
      : fail(`${GEMINI_MODEL} does not support generateContent`, 'Set GEMINI_AUDIO_MODEL to a current Gemini Flash model.');
  } catch (e) {
    fail('Gemini check failed — check GEMINI_API_KEY and GEMINI_AUDIO_MODEL', e.message);
  }
}

section('Shopify ↔ couriers');
{
  const tally = { jt: 0, bosta: 0 };
  for (const o of orders) {
    const t = trackingOf(o);
    if (t) tally[t.carrier]++;
  }
  ok('couriers on Shopify fulfillments', `J&T ${tally.jt} · Bosta ${tally.bosta} · not fulfilled ${orders.length - tally.jt - tally.bosta}`);
}
if (!BOSTA_KEY) {
  console.log('  \x1b[2mBosta businessReference join skipped — needs BOSTA_API_KEY\x1b[0m');
} else {
  const byRef = new Map();
  for (const d of deliveries) {
    const key = (d.businessReference ?? '').replace(/^#/, '').toLowerCase();
    if (key && !byRef.has(key)) byRef.set(key, d);
  }
  const matched = orders.filter((o) => byRef.has(o.name.replace(/^#/, '').toLowerCase()));
  if (orders.length === 0) {
    fail('no open orders to join against');
  } else if (matched.length === 0) {
    console.log(
      '  \x1b[2m– no open order is on a recent Bosta shipment (expected once J&T carries new orders)\x1b[0m',
    );
  } else {
    ok(
      'orders joined to shipments',
      `${matched.length}/${orders.length} matched on businessReference`,
    );
    const sample = matched[0];
    const d = byRef.get(sample.name.replace(/^#/, '').toLowerCase());
    ok(
      'sample join',
      `${sample.name} → AWB ${d.trackingNumber} · COD ${d.cod} · rank ${d.receiver?.ranking ?? '—'} · clarity ${d.dropOffAddress?.addressClarityScore ?? '—'}`,
    );
    const unshipped = orders.length - matched.length;
    if (unshipped) {
      console.log(
        `      \x1b[2m${unshipped} open order(s) have no shipment yet — they show as "New" in the app.\x1b[0m`,
      );
    }
  }
}

section('Write path (order log)');
if (!WRITE) {
  console.log('  \x1b[2mskipped — re-run with --write to test writing to a real order\x1b[0m');
} else if (!orders.length) {
  fail('no order available to write to');
} else {
  const target = orders[0];
  const entry = {
    id: `verify-${Date.now().toString(36)}`,
    at: new Date().toISOString(),
    kind: 'note',
    text: 'Connectivity check from scripts/verify-live.mjs',
  };
  try {
    const existing = target.metafield?.value ? JSON.parse(target.metafield.value) : [];
    const merged = [...existing, entry];
    const set = await shopify(
      `mutation SetMetafield($metafields: [MetafieldsSetInput!]!) {
         metafieldsSet(metafields: $metafields) { metafields { id } userErrors { field message } } }`,
      {
        metafields: [
          {
            ownerId: target.id,
            namespace: 'oka',
            key: 'activity_log',
            type: 'json',
            value: JSON.stringify(merged),
          },
        ],
      },
    );
    if (set.metafieldsSet.userErrors.length) throw new Error(JSON.stringify(set.metafieldsSet.userErrors));
    ok('activity_log metafield written', target.name);

    const upd = await shopify(
      `mutation UpdateOrder($input: OrderInput!) {
         orderUpdate(input: $input) { order { id } userErrors { field message } } }`,
      {
        input: {
          id: target.id,
          note: `── OKA WAREHOUSE LOG ──\n${new Date().toISOString()} 📝 ${entry.text}`,
        },
      },
    );
    if (upd.orderUpdate.userErrors.length) throw new Error(JSON.stringify(upd.orderUpdate.userErrors));
    ok('order note written — check the order timeline in Shopify admin', target.name);
  } catch (e) {
    fail('write failed — check the write_orders scope', e.message);
  }
}

console.log(
  failures === 0
    ? '\n\x1b[1m\x1b[32mAll checks passed.\x1b[0m The app is ready to run against live data.\n'
    : `\n\x1b[1m\x1b[31m${failures} check(s) failed.\x1b[0m See the messages above.\n`,
);
process.exit(failures === 0 ? 0 : 1);
