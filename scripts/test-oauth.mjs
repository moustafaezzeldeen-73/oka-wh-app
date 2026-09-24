/**
 * Offline tests for the Shopify OAuth helpers in scripts/shopify-token.mjs.
 *
 *   npm run test:oauth
 */

import {
  REQUIRED_SCOPES,
  authorizeUrl,
  missingScopes,
  parseEnv,
  setEnvValue,
  verifyCallbackHmac,
} from './shopify-token.mjs';

let passed = 0;
let failed = 0;
const t = (name, cond) => {
  cond ? passed++ : failed++;
  console.log(`  ${cond ? '\x1b[32m✓' : '\x1b[31m✗'}\x1b[0m ${name}`);
};

console.log('\n\x1b[1mShopify OAuth callback signature\x1b[0m');
// The example from Shopify's OAuth docs, signed with the secret "hush".
const example = new URLSearchParams(
  'code=0907a61c0c8d55e99db179b68161bc00&hmac=700e2dadb827fcc8609e9d5ce208b2e9cdaab9df07390d2cbca10d7c328fc4bf&shop=some-shop.myshopify.com&state=0.6784241404160823&timestamp=1337178173',
);
t("matches Shopify's documented example", verifyCallbackHmac(example, 'hush'));
t('rejects the wrong secret', !verifyCallbackHmac(example, 'nope'));
const tampered = new URLSearchParams(example);
tampered.set('shop', 'evil.myshopify.com');
t('rejects a tampered shop', !verifyCallbackHmac(tampered, 'hush'));
const unsigned = new URLSearchParams(example);
unsigned.delete('hmac');
t('rejects a missing signature', !verifyCallbackHmac(unsigned, 'hush'));

console.log('\n\x1b[1mAuthorization URL\x1b[0m');
const u = new URL(
  authorizeUrl({
    shop: '756009.myshopify.com',
    clientId: 'cid',
    scopes: REQUIRED_SCOPES,
    redirectUri: 'https://example.com/callback',
    state: 'abc',
  }),
);
t('points at the store authorize endpoint', u.host === '756009.myshopify.com' && u.pathname === '/admin/oauth/authorize');
t('requests every scope the app needs', u.searchParams.get('scope') === REQUIRED_SCOPES.join(','));
t('redirect URL round-trips intact', u.searchParams.get('redirect_uri') === 'https://example.com/callback');
t('carries the state nonce', u.searchParams.get('state') === 'abc');

console.log('\n\x1b[1m.env editing\x1b[0m');
const envText = 'SHOPIFY_STORE_DOMAIN=756009.myshopify.com\nSHOPIFY_ADMIN_ACCESS_TOKEN=\nBOSTA_API_KEY=x\n';
const updated = setEnvValue(envText, 'SHOPIFY_ADMIN_ACCESS_TOKEN', 'shpat_abc');
t('replaces the token line in place', parseEnv(updated).SHOPIFY_ADMIN_ACCESS_TOKEN === 'shpat_abc');
t('leaves other keys alone', parseEnv(updated).BOSTA_API_KEY === 'x');
t('does not add lines', updated.split('\n').length === envText.split('\n').length);
const appended = setEnvValue('A=1', 'B', '2');
t('appends a key that is absent', parseEnv(appended).A === '1' && parseEnv(appended).B === '2');

console.log('\n\x1b[1mScope check\x1b[0m');
t('a write scope covers its read scope', missingScopes('write_orders,write_order_edits,read_products,read_customers,write_files').length === 0);
t(
  'reports exactly what is missing',
  JSON.stringify(missingScopes('read_orders')) ===
    JSON.stringify(['write_orders', 'read_order_edits', 'write_order_edits', 'read_products', 'read_customers', 'read_files', 'write_files']),
);

console.log(`\n\x1b[1m${failed ? '\x1b[31mFailures' : '\x1b[32mAll green'}\x1b[0m — ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
