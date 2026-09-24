import Constants from 'expo-constants';

type Extra = {
  shopifyStoreDomain?: string;
  shopifyAdminToken?: string;
  shopifyClientId?: string;
  shopifyClientSecret?: string;
  shopifyApiVersion?: string;
  bostaApiKey?: string;
  bostaBaseUrl?: string;
  jtApiAccount?: string;
  jtPrivateKey?: string;
  jtCustomerCode?: string;
  jtCustomerPassword?: string;
  jtBaseUrl?: string;
  geminiApiKey?: string;
  geminiModel?: string;
  apiProxyUrl?: string;
};

const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

export const CONFIG = {
  shopify: {
    domain: (extra.shopifyStoreDomain ?? '').trim(),
    /** Legacy admin-created app token (`shpat_…`). Optional. */
    token: (extra.shopifyAdminToken ?? '').trim(),
    /** Dev Dashboard app credentials, exchanged for 24-hour tokens. */
    clientId: (extra.shopifyClientId ?? '').trim(),
    clientSecret: (extra.shopifyClientSecret ?? '').trim(),
    apiVersion: (extra.shopifyApiVersion ?? '2026-07').trim(),
  },
  bosta: {
    apiKey: (extra.bostaApiKey ?? '').trim(),
    baseUrl: (extra.bostaBaseUrl ?? 'https://app.bosta.co/api/v2').trim().replace(/\/$/, ''),
  },
  /** J&T Express Egypt Open Platform. */
  jt: {
    apiAccount: (extra.jtApiAccount ?? '').trim(),
    privateKey: (extra.jtPrivateKey ?? '').trim(),
    customerCode: (extra.jtCustomerCode ?? '').trim(),
    customerPassword: (extra.jtCustomerPassword ?? '').trim(),
    baseUrl: (extra.jtBaseUrl || 'https://openapi.jtjms-eg.com/webopenplatformapi')
      .trim()
      .replace(/\/$/, ''),
  },
  /** Call transcription. Optional: without a key, recordings upload untranscribed. */
  gemini: {
    apiKey: (extra.geminiApiKey ?? '').trim(),
    model: (extra.geminiModel ?? 'gemini-2.5-flash').trim(),
  },
  /** When set, both clients tunnel through this backend and ship no credentials. */
  proxyUrl: (extra.apiProxyUrl ?? '').trim().replace(/\/$/, ''),
} as const;

export const usingProxy = CONFIG.proxyUrl.length > 0;

/**
 * A permanent `shpat_` token wins when present; otherwise the Client ID +
 * secret are exchanged for 24-hour tokens.
 */
export const usingClientCredentials =
  CONFIG.shopify.token.length === 0 &&
  CONFIG.shopify.clientId.length > 0 &&
  CONFIG.shopify.clientSecret.length > 0;

export const bostaConfigured = usingProxy || CONFIG.bosta.apiKey.length > 0;

export const jtConfigured =
  usingProxy ||
  (CONFIG.jt.apiAccount.length > 0 &&
    CONFIG.jt.privateKey.length > 0 &&
    CONFIG.jt.customerCode.length > 0 &&
    CONFIG.jt.customerPassword.length > 0);

/**
 * Which credentials are missing, so the UI can say so precisely. Shopify is
 * required; each courier is optional on its own, but the app needs at least
 * one of them to show where parcels are.
 */
export function missingConfig(): string[] {
  if (usingProxy) return [];
  const gaps: string[] = [];
  if (!CONFIG.shopify.domain) gaps.push('SHOPIFY_STORE_DOMAIN');
  if (!usingClientCredentials && !CONFIG.shopify.token) {
    gaps.push('SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET');
  }
  if (!bostaConfigured && !jtConfigured) {
    gaps.push('BOSTA_API_KEY or JT_API_ACCOUNT + JT_PRIVATE_KEY + JT_CUSTOMER_CODE + JT_CUSTOMER_PASSWORD');
  }
  return gaps;
}

/** Couriers whose keys are missing — shown as a note, not a blocker. */
export function missingCouriers(): string[] {
  if (usingProxy) return [];
  const out: string[] = [];
  if (!bostaConfigured) out.push('Bosta (BOSTA_API_KEY)');
  if (!jtConfigured) out.push('J&T (JT_API_ACCOUNT, JT_PRIVATE_KEY, JT_CUSTOMER_CODE, JT_CUSTOMER_PASSWORD)');
  return out;
}

export const isConfigured = () => missingConfig().length === 0;
