// Template from the OKA Warehouse app. Expects the loader and rules compiled to
// .test-build/ (tsc -p tsconfig.test.json) and scripts/live-common.mjs for .env
// parsing and J&T signing — see references/delivery-analytics.md.

/**
 * The app's delivery report, in the terminal — same loader, same rules
 * (src/api/analytics.ts), fed by .env instead of the phone.
 *
 *   npm run report                       # last 30 days
 *   npm run report -- --period 7d        # 7d | 14d | 30d | month | lastMonth
 *   npm run report -- --from 2026-09-01 --to 2026-09-15
 *   npm run report -- --csv parcels.csv  # one row per order, for a spreadsheet
 *   npm run report -- --json report.json # the whole report + every parcel
 *
 * Days are Cairo days, whatever the machine's clock says.
 */

// Before anything reads the clock: periods are Cairo calendar days.
process.env.TZ = 'Africa/Cairo';

import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { jtCall, jtConfig, loadEnv, networkReason } from './live-common.mjs';
import { csv, print } from './report-format.mjs';

const require = createRequire(import.meta.url);
const { loadAnalytics } = require('../.test-build/src/api/analyticsLoader.js');
const { periodRange, PERIOD_KEYS } = require('../.test-build/src/api/analytics.js');

// ── arguments ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

function range() {
  const from = arg('from');
  const to = arg('to');
  if (from) {
    const f = new Date(`${from}T00:00:00`);
    const t = to ? new Date(`${to}T00:00:00`) : new Date();
    // --to is inclusive: the report runs to the end of that day.
    if (to) t.setDate(t.getDate() + 1);
    return { from: f, to: t };
  }
  const period = arg('period') ?? '30d';
  if (!PERIOD_KEYS.includes(period)) {
    console.error(`Unknown --period ${period}. Use one of: ${PERIOD_KEYS.join(', ')}`);
    process.exit(1);
  }
  return periodRange(period);
}

// ── .env ─────────────────────────────────────────────────────────────────────
const loaded = loadEnv();
if (!loaded) {
  console.error('No .env file found. Copy .env.example to .env and fill in your keys.');
  process.exit(1);
}
const { env } = loaded;
const SHOP = (env.SHOPIFY_STORE_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
const VERSION = env.SHOPIFY_API_VERSION || '2026-07';
const BOSTA_KEY = env.BOSTA_API_KEY;
const BOSTA_URL = (env.BOSTA_BASE_URL || 'https://app.bosta.co/api/v2').replace(/\/$/, '');
const { jt: JT, ready: JT_READY } = jtConfig(env);

async function shopifyToken() {
  if (env.SHOPIFY_ADMIN_ACCESS_TOKEN) return env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  const res = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.SHOPIFY_CLIENT_ID ?? '',
      client_secret: env.SHOPIFY_CLIENT_SECRET ?? '',
    }).toString(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Shopify token: HTTP ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text).access_token;
}

// ── sources for the shared loader ────────────────────────────────────────────
async function makeSources() {
  const token = await shopifyToken();
  return {
    shopify: async (query, variables = {}) => {
      const res = await fetch(`https://${SHOP}/admin/api/${VERSION}/graphql.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
        body: JSON.stringify({ query, variables }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(`Shopify HTTP ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
      if (body.errors) throw new Error(body.errors.map((e) => e.message).join('; '));
      return body.data;
    },
    download: async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Shopify export download: HTTP ${res.status}`);
      return res.text();
    },
    jt: JT_READY ? { customerCode: JT.customerCode, call: (path, biz, withAuth) => jtCall(JT, path, biz, withAuth) } : null,
    bosta: BOSTA_KEY
      ? async (method, path, payload) => {
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
      : null,
  };
}

// ── run ──────────────────────────────────────────────────────────────────────
const { from, to } = range();
try {
  const sources = await makeSources();
  let last = '';
  const { report, facts, warnings } = await loadAnalytics(sources, {
    from,
    to,
    onProgress: (step, done, total) => {
      const line = `  reading ${step}${total ? ` ${done}/${total}` : ''}…`;
      if (line !== last && process.stderr.isTTY) process.stderr.write(`\r${line.padEnd(40)}`);
      last = line;
    },
  });
  if (process.stderr.isTTY) process.stderr.write(`\r${''.padEnd(40)}\r`);
  print(report, warnings);
  const csvPath = arg('csv');
  if (csvPath) {
    writeFileSync(csvPath, csv(facts));
    console.log(`Wrote ${facts.length} rows to ${csvPath}`);
  }
  const jsonPath = arg('json');
  if (jsonPath) {
    writeFileSync(jsonPath, JSON.stringify({ report, facts, warnings }, null, 2));
    console.log(`Wrote the report to ${jsonPath}`);
  }
} catch (e) {
  console.error(`\n${red('Report failed:')} ${networkReason(e)}`);
  process.exit(1);
}
