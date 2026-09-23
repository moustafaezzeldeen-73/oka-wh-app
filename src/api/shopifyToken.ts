/**
 * Access tokens for a Shopify Dev Dashboard app, via the client credentials
 * grant.
 *
 * Shopify no longer lets merchants create custom apps in the admin, so there is
 * no permanent `shpat_` token to paste in. A Dev Dashboard app instead has a
 * permanent Client ID + Client secret, which are exchanged for an access token
 * valid for 24 hours (`expires_in` is always 86399). This module does that
 * exchange, caches the token, and mints a new one before it expires — so the
 * rest of the app just asks for "the token" and never sees the expiry.
 *
 * Free of network and native imports (the fetcher is injected) so the caching
 * rules can be exercised directly — see scripts/test-logic.ts.
 */

export type TokenResponse = {
  access_token: string;
  scope?: string;
  expires_in?: number;
};

export type TokenFetcher = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export type TokenSourceOptions = {
  shopDomain: string;
  clientId: string;
  clientSecret: string;
  fetcher: TokenFetcher;
  /** Refresh this long before Shopify's stated expiry. */
  refreshMarginMs?: number;
  now?: () => number;
};

export class ShopifyTokenError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ShopifyTokenError';
    this.status = status;
  }
}

const DEFAULT_LIFETIME_S = 86399;

export function createTokenSource(opts: TokenSourceOptions) {
  const margin = opts.refreshMarginMs ?? 5 * 60_000;
  const now = opts.now ?? Date.now;
  const domain = opts.shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');

  let token: string | null = null;
  let expiresAt = 0;
  let scope: string | null = null;
  // Screens fire several requests at once on launch; they must share one
  // exchange rather than each minting (and retiring) a token.
  let inflight: Promise<string> | null = null;

  async function exchange(): Promise<string> {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
    }).toString();

    const res = await opts.fetcher(`https://${domain}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
    });
    const text = await res.text();

    if (!res.ok) {
      throw new ShopifyTokenError(res.status, explain(res.status, text));
    }

    let parsed: TokenResponse;
    try {
      parsed = JSON.parse(text) as TokenResponse;
    } catch {
      throw new ShopifyTokenError(res.status, 'Shopify token endpoint returned non-JSON');
    }
    if (!parsed.access_token) {
      throw new ShopifyTokenError(res.status, 'Shopify token endpoint returned no access_token');
    }

    token = parsed.access_token;
    scope = parsed.scope ?? null;
    expiresAt = now() + (parsed.expires_in ?? DEFAULT_LIFETIME_S) * 1000;
    return token;
  }

  return {
    /** A valid token, minting a fresh one only when needed. */
    async get(): Promise<string> {
      if (token && now() < expiresAt - margin) return token;
      if (!inflight) {
        inflight = exchange().finally(() => {
          inflight = null;
        });
      }
      return inflight;
    },

    /** Drop the cached token — call after Shopify answers 401. */
    invalidate(): void {
      token = null;
      expiresAt = 0;
    },

    /** Scopes Shopify reported on the last exchange, for diagnostics. */
    grantedScope(): string | null {
      return scope;
    },
  };
}

export type TokenSource = ReturnType<typeof createTokenSource>;

/** Turn Shopify's terse OAuth errors into something a person can act on. */
function explain(status: number, body: string): string {
  const b = body.toLowerCase();
  if (b.includes('shop_not_permitted')) {
    return 'Shopify refused the client credentials grant for this store (shop_not_permitted): the app and the store must belong to the same organization in the Dev Dashboard.';
  }
  if (b.includes('invalid_client') || status === 401) {
    return 'Shopify rejected the Client ID / Client secret (invalid_client). Check both values in the Dev Dashboard → your app → Settings.';
  }
  if (b.includes('app_not_installed') || b.includes('not installed')) {
    return 'The app is not installed on this store. Install it from the Dev Dashboard, then retry.';
  }
  return `Shopify token exchange failed (HTTP ${status}): ${body.slice(0, 200)}`;
}
