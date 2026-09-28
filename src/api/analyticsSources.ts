import type { AnalyticsSources } from './analyticsLoader';
import { bostaRequest, type BostaDelivery } from './bosta';
import { CONFIG, bostaConfigured, jtConfigured } from './config';
import { ApiError } from './http';
import { jtRequest } from './jt';
import { shopifyGraphQL } from './shopify';

/** The phone's own API clients, wired into the report loader. */
export const appSources: AnalyticsSources = {
  shopify: (query, variables) => shopifyGraphQL(query, variables ?? {}),
  download: async (url) => {
    // The bulk export is a signed Google Cloud Storage link; no Shopify headers.
    const res = await fetch(url);
    if (!res.ok) throw new ApiError('shopify', res.status, `Shopify export download: HTTP ${res.status}`);
    return res.text();
  },
  // Behind a proxy the proxy holds the customer code and fills it in.
  jt: jtConfigured ? { customerCode: CONFIG.jt.customerCode, call: jtRequest } : null,
  bosta: bostaConfigured ? bostaRequest : null,
};

/** Finished Bosta parcels already read this session — their fees never change. */
export const bostaDetailCache = new Map<string, BostaDelivery>();
