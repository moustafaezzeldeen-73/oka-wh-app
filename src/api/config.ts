import Constants from 'expo-constants';

type Extra = {
  shopifyStoreDomain?: string;
  shopifyAdminToken?: string;
  shopifyClientId?: string;
  shopifyClientSecret?: string;
  shopifyApiVersion?: string;
  bostaApiKey?: string;
  bostaBaseUrl?: string;
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

/** Which credentials are missing, so the UI can say so precisely. */
export function missingConfig(): string[] {
  if (usingProxy) return [];
  const gaps: string[] = [];
  if (!CONFIG.shopify.domain) gaps.push('SHOPIFY_STORE_DOMAIN');
  if (!usingClientCredentials && !CONFIG.shopify.token) {
    gaps.push('SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET');
  }
  if (!CONFIG.bosta.apiKey) gaps.push('BOSTA_API_KEY');
  return gaps;
}

export const isConfigured = () => missingConfig().length === 0;
