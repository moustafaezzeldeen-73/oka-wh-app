/**
 * Shared by the live-check scripts: reading .env exactly as the app sees it,
 * and signed calls to the J&T Open Platform.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import util from 'node:util';

/**
 * .env parsed the way Expo parses it for the app: an unquoted # starts a
 * comment, so `PASSWORD=abc#def` reaches the app as "abc". `cutAtHash` names
 * every unquoted value that loses something that way. Null when there is no
 * .env file.
 */
export function loadEnv() {
  let text;
  try {
    text = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  } catch {
    return null;
  }
  let env = {};
  if (typeof util.parseEnv === 'function') {
    env = util.parseEnv(text);
  } else {
    for (const line of text.split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2').replace(/^([^"'][^#]*)#.*$/, '$1').trim();
    }
  }
  const cutAtHash = [];
  for (const line of text.split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*([^"'\s].*)$/.exec(line);
    if (m && m[2].includes('#')) cutAtHash.push(m[1]);
  }
  return { env, cutAtHash };
}

/** J&T settings from .env, and whether all four keys are present. */
export function jtConfig(env) {
  const jt = {
    baseUrl: (env.JT_API_BASE_URL || 'https://openapi.jtjms-eg.com/webopenplatformapi').replace(/\/$/, ''),
    apiAccount: env.JT_API_ACCOUNT,
    privateKey: env.JT_PRIVATE_KEY,
    customerCode: env.JT_CUSTOMER_CODE,
    customerPassword: env.JT_CUSTOMER_PASSWORD,
  };
  return { jt, ready: !!(jt.apiAccount && jt.privateKey && jt.customerCode && jt.customerPassword) };
}

/** One signed J&T call — the same signing as src/api/jtState.ts and the J&T connector. */
export async function jtCall(jt, path, bizContent, withAuth) {
  const b64md5 = (s) => createHash('md5').update(s, 'utf8').digest('base64');
  const hashedPassword = createHash('md5').update(jt.customerPassword + 'jadada236t2').digest('hex').toUpperCase();
  const body = withAuth
    ? { customerCode: jt.customerCode, digest: b64md5(jt.customerCode + hashedPassword + jt.privateKey), ...bizContent }
    : bizContent;
  const json = JSON.stringify(body);
  const res = await fetch(`${jt.baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      apiAccount: jt.apiAccount,
      digest: b64md5(json + jt.privateKey),
      timestamp: String(Date.now()),
    },
    body: new URLSearchParams({ bizContent: json }).toString(),
  });
  const text = await res.text();
  let out = null;
  try {
    out = JSON.parse(text);
  } catch {
    // Not J&T answering — a proxy or gateway page.
  }
  if (!res.ok || !out) throw new Error(`HTTP ${res.status}: ${text.slice(0, 160).trim()}`);
  if (out.code !== '1') throw new Error(`J&T ${out.code}: ${out.msg}`);
  return out.data;
}

/** The underlying reason for a failed fetch, e.g. ENOTFOUND or a 403 from a proxy. */
export function networkReason(e) {
  const cause = e?.cause;
  return [e?.message, cause?.code, cause?.message].filter(Boolean).join(' — ');
}
