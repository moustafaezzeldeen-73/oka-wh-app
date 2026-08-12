#!/usr/bin/env node
/**
 * Live end-to-end check against the real Shopify and Bosta accounts.
 *
 * Reads .env, then exercises every API path the app depends on — reads first,
 * and the write paths only when you pass --write. Run it once after filling in
 * .env to confirm the credentials and scopes are right before handing phones to
 * the warehouse.
 *
 *   npm run verify            # read-only
 *   npm run verify -- --write # also writes a log entry to one real order
 */

import { readFileSync } from 'node:fs';

const WRITE = process.argv.includes('--write');

// ── .env ─────────────────────────────────────────────────────────────────────
const env = {};
try {
  for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
} catch {
  fail('No .env file found. Copy .env.example to .env and fill in your keys.');
  process.exit(1);
}

const SHOP = env.SHOPIFY_STORE_DOMAIN;
const TOKEN = env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const VERSION = env.SHOPIFY_API_VERSION || '2026-07';
const BOSTA_KEY = env.BOSTA_API_KEY;
const BOSTA_URL = (env.BOSTA_BASE_URL || 'https://app.bosta.co/api/v2').replace(/\/$/, '');

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

// ─────────────────────────────────────────────────────────────────────────────

section('Configuration');
for (const [name, value] of [
  ['SHOPIFY_STORE_DOMAIN', SHOP],
  ['SHOPIFY_ADMIN_ACCESS_TOKEN', TOKEN],
  ['BOSTA_API_KEY', BOSTA_KEY],
]) {
  value ? ok(`${name} set`) : fail(`${name} missing`);
}
if (failures) {
  console.log('\nFill in .env before re-running.\n');
  process.exit(1);
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
try {
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

section('Shopify ↔ Bosta join');
{
  const byRef = new Map();
  for (const d of deliveries) {
    const key = (d.businessReference ?? '').replace(/^#/, '').toLowerCase();
    if (key && !byRef.has(key)) byRef.set(key, d);
  }
  const matched = orders.filter((o) => byRef.has(o.name.replace(/^#/, '').toLowerCase()));
  if (orders.length === 0) {
    fail('no open orders to join against');
  } else if (matched.length === 0) {
    fail(
      'no open order matched a Bosta shipment',
      'Bosta businessReference must equal the Shopify order name (e.g. "#2623721").',
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
