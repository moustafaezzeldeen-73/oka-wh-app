#!/usr/bin/env node
/**
 * Gets Shopify API access for the app from the Dev Dashboard Client ID and
 * secret in .env.
 *
 *   npm run shopify:token
 *     Exchanges the Client ID + secret for an access token (client credentials
 *     grant) and checks its scopes. This is all the app needs: it repeats the
 *     same exchange itself every 24 hours.
 *
 *   npm run shopify:token -- --permanent
 *     One-time browser approval (authorization code grant) that returns a
 *     non-expiring `shpat_` token and saves it to .env as
 *     SHOPIFY_ADMIN_ACCESS_TOKEN. With that set, the Client secret is no
 *     longer bundled into the app.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

export const REQUIRED_SCOPES = [
  'read_orders',
  'write_orders',
  'read_order_edits',
  'write_order_edits',
  'read_products',
  'read_customers',
  'read_files',
  'write_files',
];

export const DEFAULT_REDIRECT = 'https://example.com/callback';

// ── pure helpers (exported for tests) ────────────────────────────────────────

export function parseEnv(text) {
  const env = {};
  for (const line of text.split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return env;
}

/** Set `key=value` in .env text, replacing an existing line or appending one. */
export function setEnvValue(text, key, value) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^\\s*${key}\\s*=.*$`, 'm');
  if (re.test(text)) return text.replace(re, line);
  return `${text.replace(/\n*$/, '\n')}${line}\n`;
}

export function authorizeUrl({ shop, clientId, scopes, redirectUri, state }) {
  const q = new URLSearchParams({
    client_id: clientId,
    scope: scopes.join(','),
    redirect_uri: redirectUri,
    state,
  });
  return `https://${shop}/admin/oauth/authorize?${q.toString()}`;
}

/**
 * Shopify signs the redirect: HMAC-SHA256 over every query parameter except
 * `hmac`, sorted by key and joined as `k=v&k=v`, keyed with the client secret.
 */
export function verifyCallbackHmac(params, secret) {
  const given = params.get('hmac');
  if (!given) return false;
  const message = [...params.entries()]
    .filter(([k]) => k !== 'hmac' && k !== 'signature')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const expected = createHmac('sha256', secret).update(message).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(given, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function missingScopes(granted) {
  const set = new Set(
    String(granted ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  // A write scope implies its read scope.
  const has = (s) => set.has(s) || set.has(s.replace(/^read_/, 'write_'));
  return REQUIRED_SCOPES.filter((s) => !has(s));
}

export function explainOAuthError(status, body) {
  const b = String(body).toLowerCase();
  if (b.includes('shop_not_permitted')) {
    return 'Shopify only allows this for stores in the same Dev Dashboard organization as the app. Use --permanent instead: it works for any store you can approve the app on.';
  }
  if (b.includes('invalid_client') || status === 401) {
    return 'Client ID or secret rejected. Recopy both from Dev Dashboard → Apps → your app → Settings → Credentials.';
  }
  if (b.includes('invalid_request') && b.includes('code')) {
    return 'The approval code was rejected. Codes work once and expire within minutes — run the command again and paste the new address straight away.';
  }
  if (b.includes('redirect')) {
    return 'The redirect URL does not match one registered on the app. Add it on the app version in the Dev Dashboard and release the version.';
  }
  return '';
}

// ── network ──────────────────────────────────────────────────────────────────

async function postForm(url, fields) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(fields).toString(),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Non-JSON bodies (HTML error pages) are reported verbatim below.
  }
  return { ok: res.ok, status: res.status, text, json };
}

async function shopName(shop, version, token) {
  const res = await fetch(`https://${shop}/admin/api/${version}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query: '{ shop { name myshopifyDomain } }' }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.errors) {
    throw new Error(`HTTP ${res.status}: ${JSON.stringify(body.errors ?? body).slice(0, 200)}`);
  }
  return body.data.shop;
}

// ── main ─────────────────────────────────────────────────────────────────────

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

async function main() {
  const envPath = new URL('../.env', import.meta.url);
  let envText;
  try {
    envText = readFileSync(envPath, 'utf8');
  } catch {
    console.log(red('No .env file. Run `cp .env.example .env` and fill in the Shopify values first.'));
    process.exit(1);
  }
  const env = parseEnv(envText);
  const shop = (env.SHOPIFY_STORE_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const clientId = env.SHOPIFY_CLIENT_ID;
  const secret = env.SHOPIFY_CLIENT_SECRET;
  const version = env.SHOPIFY_API_VERSION || '2026-07';

  const gaps = [
    !shop && 'SHOPIFY_STORE_DOMAIN',
    !clientId && 'SHOPIFY_CLIENT_ID',
    !secret && 'SHOPIFY_CLIENT_SECRET',
  ].filter(Boolean);
  if (gaps.length) {
    console.log(red(`Missing in .env: ${gaps.join(', ')}`));
    process.exit(1);
  }

  const permanent = process.argv.includes('--permanent');

  if (!permanent) {
    console.log(bold('\nClient credentials grant'));
    const r = await postForm(`https://${shop}/admin/oauth/access_token`, {
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: secret,
    });
    if (!r.ok || !r.json?.access_token) {
      console.log(red(`  ✗ Shopify refused (HTTP ${r.status}): ${r.text.slice(0, 200)}`));
      const hint = explainOAuthError(r.status, r.text);
      if (hint) console.log(`    ${hint}`);
      process.exit(1);
    }
    const s = await shopName(shop, version, r.json.access_token);
    console.log(green(`  ✓ access token issued for ${s.name} (${s.myshopifyDomain}), valid 24h`));
    const miss = missingScopes(r.json.scope);
    if (miss.length) {
      console.log(red(`  ✗ scopes missing: ${miss.join(', ')}`));
      console.log('    Add them on the app version in the Dev Dashboard, release it, and approve the update on the store.');
      process.exit(1);
    }
    console.log(green('  ✓ all scopes the app needs are granted'));
    console.log(
      `\nThe app is ready: it performs this same exchange itself and renews the token\nevery 24 hours. For a token that never expires, run ${bold('npm run shopify:token -- --permanent')}.\n`,
    );
    return;
  }

  // ── permanent token via the authorization code grant ──
  const redirectUri = env.SHOPIFY_REDIRECT_URI || DEFAULT_REDIRECT;
  const state = randomBytes(12).toString('hex');
  const url = authorizeUrl({ shop, clientId, scopes: REQUIRED_SCOPES, redirectUri, state });

  console.log(bold('\nPermanent Shopify access token\n'));
  console.log(`1. Make sure ${bold(redirectUri)} is listed as a redirect URL on your app`);
  console.log('   version in the Dev Dashboard, and that version is released.\n');
  console.log('2. Open this link in a browser where you are logged in to the store admin,');
  console.log('   and approve the app:\n');
  console.log(`   ${url}\n`);
  console.log(`3. Your browser then lands on ${redirectUri}?code=… — the page itself may`);
  console.log('   show nothing or an error; that is fine. Copy the whole address from the');
  console.log('   address bar and paste it here.\n');

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const pasted = (await rl.question('Address: ')).trim();
  rl.close();

  let code;
  try {
    const params = new URL(pasted).searchParams;
    if (params.get('state') !== state) {
      console.log(red('✗ That address came from a different approval (state mismatch). Run the command again and use the new link.'));
      process.exit(1);
    }
    if (params.get('shop') && params.get('shop') !== shop) {
      console.log(red(`✗ Approved on ${params.get('shop')}, but .env is set to ${shop}.`));
      process.exit(1);
    }
    if (!verifyCallbackHmac(params, secret)) {
      console.log(red('✗ The address is not signed by Shopify with this app\'s secret (HMAC mismatch). Check SHOPIFY_CLIENT_SECRET.'));
      process.exit(1);
    }
    code = params.get('code');
  } catch {
    console.log(red('✗ That is not a full address. Paste everything from the address bar, starting with https://'));
    process.exit(1);
  }
  if (!code) {
    console.log(red('✗ No code in that address — the approval may have been cancelled.'));
    process.exit(1);
  }

  const r = await postForm(`https://${shop}/admin/oauth/access_token`, {
    client_id: clientId,
    client_secret: secret,
    code,
  });
  if (!r.ok || !r.json?.access_token) {
    console.log(red(`✗ Shopify refused the code (HTTP ${r.status}): ${r.text.slice(0, 200)}`));
    const hint = explainOAuthError(r.status, r.text);
    if (hint) console.log(`  ${hint}`);
    process.exit(1);
  }

  const token = r.json.access_token;
  const s = await shopName(shop, version, token);
  console.log(green(`\n✓ Permanent token issued for ${s.name} (${s.myshopifyDomain})`));
  if (r.json.expires_in) {
    console.log(red(`  Note: Shopify marked this token as expiring in ${r.json.expires_in}s.`));
  }
  const miss = missingScopes(r.json.scope);
  miss.length
    ? console.log(red(`✗ scopes missing: ${miss.join(', ')} — add them on the app version and approve again.`))
    : console.log(green('✓ all scopes the app needs are granted'));

  writeFileSync(envPath, setEnvValue(envText, 'SHOPIFY_ADMIN_ACCESS_TOKEN', token), { mode: 0o600 });
  console.log(green('✓ saved to .env as SHOPIFY_ADMIN_ACCESS_TOKEN'));
  console.log(dim('  The app now uses this token and no longer bundles the Client secret.'));
  console.log(dim('  It stays valid until the app is uninstalled or the secret is revoked.\n'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(red(`✗ ${err instanceof Error ? err.message : err}`));
    process.exit(1);
  });
}
