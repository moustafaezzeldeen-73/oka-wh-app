#!/usr/bin/env node
/**
 * Proves the J&T keys in .env work, without needing Shopify or Bosta.
 *
 *   npm run check:jt                          # keys only
 *   npm run check:jt -- JEG000541604917 …     # also read these parcels
 *
 * 1. A signed order query for a reference that can't exist (SHOPIFY0): J&T
 *    only answers "success" if all four values are right — apiAccount and
 *    privateKey sign the request, customer code and password sign the query.
 * 2. A tracking call, which checks the account may read scan history.
 */

import { jtCall, jtConfig, loadEnv, networkReason } from './live-common.mjs';

const awbs = process.argv.slice(2).filter((a) => /^[A-Z]{2,4}\d{6,}$/i.test(a)).map((a) => a.toUpperCase());

const ok = (m, x = '') => console.log(`  \x1b[32m✓\x1b[0m ${m}${x ? ` \x1b[2m${x}\x1b[0m` : ''}`);
let failures = 0;
const bad = (m, x = '') => {
  failures++;
  console.log(`  \x1b[31m✗\x1b[0m ${m}${x ? `\n      ${x}` : ''}`);
};

const loaded = loadEnv();
if (!loaded) {
  console.log('No .env file. Copy .env.example to .env and fill in the JT_* values.');
  process.exit(1);
}
const { jt, ready } = jtConfig(loaded.env);

console.log('\n\x1b[1mJ&T keys in .env\x1b[0m');
for (const key of loaded.cutAtHash.filter((k) => k.startsWith('JT_'))) {
  bad(`${key} contains # without quotes — the app only sees the part before it`, `Write it as ${key}="…"`);
}
for (const [key, val] of [
  ['JT_API_ACCOUNT', jt.apiAccount],
  ['JT_PRIVATE_KEY', jt.privateKey],
  ['JT_CUSTOMER_CODE', jt.customerCode],
  ['JT_CUSTOMER_PASSWORD', jt.customerPassword],
]) {
  val ? ok(`${key} set`, `${val.length} characters`) : bad(`${key} missing`);
}
if (!ready) process.exit(1);
console.log(`  \x1b[2m${jt.baseUrl}\x1b[0m`);

const unreachable = (e) =>
  /fetch failed|ENOTFOUND|ECONN|ETIMEDOUT|EAI_AGAIN|UND_ERR|403/i.test(networkReason(e));

console.log('\n\x1b[1mLive J&T API\x1b[0m');
try {
  const data = await jtCall(jt, '/api/order/getOrders', { command: 1, serialNumber: ['SHOPIFY0'] }, true);
  ok('keys accepted — signed order query succeeded', `${Array.isArray(data) ? data.length : 0} results for a dummy reference, as expected`);
} catch (e) {
  if (unreachable(e)) {
    bad(`could not reach ${new URL(jt.baseUrl).host}`, `${networkReason(e)}\n      This network blocks J&T. Run it from the Codespace, or allow the host.`);
    process.exit(1);
  }
  bad('J&T rejected the keys', `${e.message}\n      apiAccount/privateKey sign every request; customer code/password sign order queries.`);
}

try {
  const probe = awbs.length ? awbs : ['JEG000000000000'];
  const traces = await jtCall(jt, '/api/logistics/trace', { billCodes: probe.join(',') }, false);
  ok('tracking permission', awbs.length ? `${traces.length} AWB(s) answered` : 'trace call accepted');
  for (const t of awbs.length ? traces : []) {
    const latest = (t.details ?? [])[0];
    console.log(
      `      ${t.billCode}: ${latest ? `${latest.scanType} · ${latest.scanTime} (Cairo)` : 'no scans yet'}`,
    );
  }
} catch (e) {
  bad('tracking call failed', e.message);
}

if (awbs.length) {
  try {
    const orders = await jtCall(jt, '/api/order/getOrders', { command: 2, serialNumber: awbs }, true);
    ok('order records', `${orders.length}/${awbs.length} found`);
    for (const o of orders) {
      console.log(`      ${o.billCode} → ${o.txlogisticId} · COD ${o.itemsValue} ${o.priceCurrency ?? ''} · status ${o.orderStatus}`);
    }
  } catch (e) {
    bad('order lookup by AWB failed', e.message);
  }
}

console.log(
  failures === 0
    ? '\n\x1b[1m\x1b[32mJ&T keys work.\x1b[0m\n'
    : `\n\x1b[1m\x1b[31m${failures} problem(s)\x1b[0m — see above.\n`,
);
process.exit(failures === 0 ? 0 : 1);
