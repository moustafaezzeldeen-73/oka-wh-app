import Constants from 'expo-constants';

type Extra = {
  shopifyStoreDomain?: string;
  shopifyAdminToken?: string;
  shopifyApiVersion?: string;
  bostaApiKey?: string;
  bostaBaseUrl?: string;
  apiProxyUrl?: string;
};

const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

export const CONFIG = {
  shopify: {
    domain: (extra.shopifyStoreDomain ?? '').trim(),
    token: (extra.shopifyAdminToken ?? '').trim(),
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

/** Which credentials are missing, so the UI can say so precisely. */
export function missingConfig(): string[] {
  if (usingProxy) return [];
  const gaps: string[] = [];
  if (!CONFIG.shopify.domain) gaps.push('SHOPIFY_STORE_DOMAIN');
  if (!CONFIG.shopify.token) gaps.push('SHOPIFY_ADMIN_ACCESS_TOKEN');
  if (!CONFIG.bosta.apiKey) gaps.push('BOSTA_API_KEY');
  return gaps;
}

export const isConfigured = () => missingConfig().length === 0;
