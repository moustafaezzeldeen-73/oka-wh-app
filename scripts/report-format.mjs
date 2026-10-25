/**
 * Terminal rendering of the delivery report (scripts/report.mjs), kept apart
 * so it can be exercised on saved live data without calling any API.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { REASON_LABEL } = require('../.test-build/src/api/analytics.js');

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const pct = (x) => (x === null || x === undefined ? '—' : `${Math.round(x * 100)}%`);
const egp = (n) => `${Math.round(n).toLocaleString('en-US')} EGP`;
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);
const day = (iso) => new Date(iso).toLocaleDateString('en-CA');
const NAMES = { jt: 'J&T', bosta: 'Bosta', inhouse: 'In-house' };

export function print(r, warnings) {
  const lastDay = new Date(new Date(r.to).getTime() - 1);
  console.log(`\n${bold('OKA delivery report')}  ${day(r.from)} → ${day(lastDay.toISOString())} ${dim('(Cairo days)')}`);
  console.log(dim(`${r.orders} orders · ${r.totals.shipments} parcels · ${r.notShipped} not shipped · ${r.cancelledOrders} cancelled before shipping`));

  const t = r.totals;
  console.log(`\n${bold('Rates')} ${dim(`(finished parcels: ${t.closed})`)}`);
  console.log(`  delivered ${green(pct(t.deliveryRate))}   returned ${red(pct(t.failureRate))}   on the way ${t.active}   awaiting pickup ${t.waiting}${t.unknown ? `   unknown ${t.unknown}` : ''}`);
  console.log(`  first-attempt ${pct(t.firstAttemptRate)}   average attempts ${t.avgAttempts === null ? '—' : t.avgAttempts.toFixed(1)}`);
  if (r.stale.count) {
    console.log(red(`  ${r.stale.count} parcels booked over ${r.stale.days} days ago were never picked up: ${r.stale.orders.slice(0, 15).join(' ')}${r.stale.count > 15 ? ' …' : ''}`));
  }

  console.log(`\n${bold('Couriers')}`);
  for (const c of r.carriers) {
    console.log(
      `  ${pad(NAMES[c.carrier], 9)} ${lpad(c.shipments, 4)} parcels  delivered ${lpad(pct(c.deliveryRate), 4)}  returned ${lpad(pct(c.failureRate), 4)}  collected ${lpad(egp(c.collected), 12)}  fees ${lpad(egp(c.fees), 10)}  net ${lpad(egp(c.net), 12)}`,
    );
  }

  console.log(`\n${bold('Why parcels come back')} ${dim(`(${r.failed.count} returns)`)}`);
  for (const x of r.reasons) {
    console.log(`  ${pad(REASON_LABEL[x.key].en, 34)} ${lpad(x.count, 4)}  ${lpad(pct(x.share), 4)}  ${dim(x.examples[0]?.text ?? '')}`);
  }
  if (r.attemptReasons.length) {
    console.log(dim(`  every failed attempt: ${r.attemptReasons.map((x) => `${REASON_LABEL[x.key].en} ${x.count}`).join(' · ')}`));
  }

  console.log(`\n${bold('Worst governorates')} ${dim('(ranked by return rate, adjusted for small numbers)')}`);
  for (const g of r.governorates.slice(0, 10)) {
    console.log(`  ${pad(g.en, 16)} ${lpad(pct(g.failureRate), 4)}  ${lpad(g.failed, 3)}/${pad(g.closed, 4)} returns cost ${egp(g.failedCost)}`);
  }
  if (r.areas.length) {
    console.log(`\n${bold('Worst areas')} ${dim('(3+ finished parcels)')}`);
    for (const a of r.areas.slice(0, 10)) {
      console.log(`  ${pad(a.en, 34)} ${lpad(pct(a.failureRate), 4)}  ${lpad(a.failed, 3)}/${a.closed}`);
    }
  }

  const f = r.failed;
  console.log(`\n${bold('Cost of returns')}`);
  console.log(`  ${red(egp(f.cost))} on ${f.count} returned parcels${f.avgCost !== null ? ` (${egp(f.avgCost)} each)` : ''}${f.estimated ? dim(` — ${egp(f.estimated)} estimated`) : ''}`);
  console.log(`  goods value that came back unsold: ${egp(f.uncollected)}`);

  const m = r.money;
  console.log(`\n${bold('Money')}`);
  const rows = [
    ['in', 'J&T cash collected', m.in.jt],
    ['in', 'Bosta cash collected', m.in.bosta],
    ['in', 'In-house cash collected', m.in.inhouse],
    ['in', 'Paid online', m.in.online],
    ['out', 'J&T shipping fees', m.out.jt],
    ['out', 'Bosta shipping fees', m.out.bosta],
    ['out', 'In-house delivery costs', m.out.inhouse],
    ['out', 'Refunds', m.out.refunds],
  ];
  for (const [dir, label, v] of rows) {
    if (v) console.log(`  ${dir === 'in' ? green('+') : red('−')} ${pad(label, 26)} ${lpad(egp(v), 14)}`);
  }
  console.log(`  ${pad('  money in', 28)} ${lpad(egp(m.in.total), 14)}`);
  console.log(`  ${pad('  money out', 28)} ${lpad(egp(m.out.total), 14)}`);
  console.log(`  ${bold(pad('  balance', 28))} ${bold(lpad(egp(m.balance), 14))}`);
  if (m.onTheRoad) console.log(dim(`  cash still with couriers on active parcels: ${egp(m.onTheRoad)}`));
  if (m.estimated) console.log(dim(`  ${egp(m.estimated)} of fees estimated from the courier's average`));
  if (m.fromShopify) console.log(dim(`  ${egp(m.fromShopify)} of cash collected taken from Shopify (courier amount not returned)`));

  if (warnings.length) console.log(`\n${red('Not fully read:')} ${warnings.join(' · ')}`);
  console.log('');
}

export function csv(facts) {
  const cols = ['order', 'createdAt', 'carrier', 'awb', 'outcome', 'gov', 'areaLabel', 'attempts', 'reasonKey', 'reasonText', 'value', 'cod', 'collected', 'online', 'refunded', 'fee'];
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(',')];
  for (const f of facts) {
    const row = { ...f, reasonKey: f.reason?.key ?? '', reasonText: f.reason?.text ?? '' };
    lines.push(cols.map((c) => esc(row[c])).join(','));
  }
  // BOM so Excel opens the Arabic city names correctly.
  return `﻿${lines.join('\n')}\n`;
}

