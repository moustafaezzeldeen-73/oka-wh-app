import { CONFIG, usingClientCredentials, usingProxy } from './config';
import { ApiError, fetchJson } from './http';
import { createTokenSource, ShopifyTokenError } from './shopifyToken';

type GraphQLResponse<T> = {
  data?: T;
  errors?: { message: string; extensions?: Record<string, unknown> }[];
  extensions?: Record<string, unknown>;
};

function endpoint(): string {
  if (usingProxy) return `${CONFIG.proxyUrl}/shopify`;
  const domain = CONFIG.shopify.domain.replace(/^https?:\/\//, '');
  return `https://${domain}/admin/api/${CONFIG.shopify.apiVersion}/graphql.json`;
}

const tokens = usingClientCredentials
  ? createTokenSource({
      shopDomain: CONFIG.shopify.domain,
      clientId: CONFIG.shopify.clientId,
      clientSecret: CONFIG.shopify.clientSecret,
      fetcher: (url, init) => fetch(url, init),
    })
  : null;

async function accessToken(): Promise<string> {
  if (!tokens) return CONFIG.shopify.token;
  try {
    return await tokens.get();
  } catch (err) {
    if (err instanceof ShopifyTokenError) throw new ApiError('shopify', err.status, err.message);
    throw err;
  }
}

async function headers(): Promise<Record<string, string>> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (!usingProxy) h['X-Shopify-Access-Token'] = await accessToken();
  return h;
}

export async function shopifyGraphQL<T>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const send = async () =>
    fetchJson<GraphQLResponse<T>>(
      endpoint(),
      { method: 'POST', headers: await headers(), body: JSON.stringify({ query, variables }) },
      usingProxy ? 'proxy' : 'shopify',
    );

  let res: GraphQLResponse<T>;
  try {
    res = await send();
  } catch (err) {
    // A rotated secret or a token Shopify retired early: mint a fresh one once.
    if (tokens && err instanceof ApiError && err.status === 401) {
      tokens.invalidate();
      res = await send();
    } else {
      throw err;
    }
  }

  if (res.errors?.length) {
    throw new ApiError('shopify', 200, res.errors.map((e) => e.message).join('; '));
  }
  if (!res.data) throw new ApiError('shopify', 200, 'Shopify returned no data');
  return res.data;
}

/** Surfaces `userErrors` from a mutation payload as a thrown ApiError. */
export function assertNoUserErrors(
  payload: { userErrors?: { field?: string[] | null; message: string }[] } | null | undefined,
  what: string,
): void {
  const errs = payload?.userErrors ?? [];
  if (errs.length) {
    throw new ApiError(
      'shopify',
      200,
      `${what}: ${errs.map((e) => `${e.field?.join('.') ?? ''} ${e.message}`.trim()).join('; ')}`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Types mirroring the fields we actually select
// ─────────────────────────────────────────────────────────────────────────────

export type ShopifyMoney = { shopMoney: { amount: string; currencyCode: string } };

export type ShopifyLineItem = {
  id: string;
  title: string;
  quantity: number;
  /** After order edits; `quantity` keeps what was originally ordered. */
  currentQuantity?: number;
  sku: string | null;
  variantTitle: string | null;
  variant: { id: string; title: string; price: string; image: { url: string } | null } | null;
  image: { url: string } | null;
  originalUnitPriceSet: ShopifyMoney;
  /** Net of line, order-level and code discounts — what the customer pays per unit. */
  discountedUnitPriceAfterAllDiscountsSet?: ShopifyMoney;
};

export type ShopifyFulfillment = {
  status: string;
  createdAt: string;
  /** Where OKA records which courier took the parcel, e.g. "J&T Express" / "Bosta". */
  trackingInfo: { company: string | null; number: string | null; url: string | null }[];
};

export type ShopifyOrder = {
  id: string;
  name: string;
  note: string | null;
  tags: string[];
  createdAt: string;
  cancelledAt: string | null;
  displayFulfillmentStatus: string;
  displayFinancialStatus: string;
  currentSubtotalPriceSet: ShopifyMoney;
  totalShippingPriceSet: ShopifyMoney;
  currentTotalPriceSet: ShopifyMoney;
  /** What the customer still owes — the cash a courier should collect. */
  totalOutstandingSet?: ShopifyMoney;
  fulfillments?: ShopifyFulfillment[];
  customer: { id: string; displayName: string; phone: string | null } | null;
  shippingAddress: {
    name: string | null;
    phone: string | null;
    address1: string | null;
    address2: string | null;
    city: string | null;
    province: string | null;
    country: string | null;
  } | null;
  lineItems: { nodes: ShopifyLineItem[] };
  metafield: { id: string; value: string } | null;
};

const ORDER_FIELDS = `
  id
  name
  note
  tags
  createdAt
  cancelledAt
  displayFulfillmentStatus
  displayFinancialStatus
  currentSubtotalPriceSet { shopMoney { amount currencyCode } }
  totalShippingPriceSet { shopMoney { amount currencyCode } }
  currentTotalPriceSet { shopMoney { amount currencyCode } }
  totalOutstandingSet { shopMoney { amount currencyCode } }
  fulfillments(first: 5) { status createdAt trackingInfo(first: 3) { company number url } }
  customer { id displayName phone }
  shippingAddress { name phone address1 address2 city province country }
  lineItems(first: 50) {
    nodes {
      id
      title
      quantity
      currentQuantity
      sku
      variantTitle
      variant { id title price image { url } }
      image { url }
      originalUnitPriceSet { shopMoney { amount } }
      discountedUnitPriceAfterAllDiscountsSet { shopMoney { amount } }
    }
  }
  metafield(namespace: "oka", key: "activity_log") { id value }
`;

/**
 * Warehouse working set: open orders, newest first.
 * `extraQuery` narrows it further (used by search).
 */
export async function fetchOrders(limit = 50, extraQuery = ''): Promise<ShopifyOrder[]> {
  const q = ['status:open', extraQuery].filter(Boolean).join(' AND ');
  const data = await shopifyGraphQL<{ orders: { nodes: ShopifyOrder[] } }>(
    `query Orders($n: Int!, $q: String!) {
       orders(first: $n, query: $q, sortKey: CREATED_AT, reverse: true) {
         nodes { ${ORDER_FIELDS} }
       }
     }`,
    { n: limit, q },
  );
  return data.orders.nodes;
}

export async function fetchOrderById(id: string): Promise<ShopifyOrder | null> {
  const data = await shopifyGraphQL<{ order: ShopifyOrder | null }>(
    `query Order($id: ID!) { order(id: $id) { ${ORDER_FIELDS} } }`,
    { id },
  );
  return data.order;
}

/** Look an order up by its human name, e.g. `#2623721`. */
export async function fetchOrderByName(name: string): Promise<ShopifyOrder | null> {
  const clean = name.replace(/^#/, '');
  const data = await shopifyGraphQL<{ orders: { nodes: ShopifyOrder[] } }>(
    `query OrderByName($q: String!) {
       orders(first: 1, query: $q) { nodes { ${ORDER_FIELDS} } }
     }`,
    { q: `name:${clean}` },
  );
  return data.orders.nodes[0] ?? null;
}

export type CatalogProduct = {
  id: string;
  title: string;
  image: string | null;
  variantId: string;
  price: string;
  sku: string | null;
  available: number | null;
};

/** Products offered on the "add product" list in the edit screen. */
export async function fetchCatalog(limit = 40): Promise<CatalogProduct[]> {
  const data = await shopifyGraphQL<{
    products: {
      nodes: {
        id: string;
        title: string;
        featuredImage: { url: string } | null;
        variants: {
          nodes: {
            id: string;
            price: string;
            sku: string | null;
            inventoryQuantity: number | null;
            image: { url: string } | null;
          }[];
        };
      }[];
    };
  }>(
    `query Catalog($n: Int!) {
       products(first: $n, query: "status:active", sortKey: TITLE) {
         nodes {
           id
           title
           featuredImage { url }
           variants(first: 1) {
             nodes { id price sku inventoryQuantity image { url } }
           }
         }
       }
     }`,
    { n: limit },
  );

  return data.products.nodes
    .map((p) => {
      const v = p.variants.nodes[0];
      if (!v) return null;
      return {
        id: p.id,
        title: p.title,
        image: p.featuredImage?.url ?? v.image?.url ?? null,
        variantId: v.id,
        price: v.price,
        sku: v.sku,
        available: v.inventoryQuantity,
      } satisfies CatalogProduct;
    })
    .filter((p): p is CatalogProduct => p !== null);
}

// ─────────────────────────────────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────────────────────────────────

export async function updateOrderNoteAndTags(
  orderId: string,
  note: string | null,
  tags?: string[],
): Promise<void> {
  const input: Record<string, unknown> = { id: orderId };
  if (note !== null) input.note = note;
  if (tags) input.tags = tags;

  const data = await shopifyGraphQL<{
    orderUpdate: { userErrors: { field?: string[] | null; message: string }[] };
  }>(
    `mutation UpdateOrder($input: OrderInput!) {
       orderUpdate(input: $input) {
         order { id }
         userErrors { field message }
       }
     }`,
    { input },
  );
  assertNoUserErrors(data.orderUpdate, 'orderUpdate');
}

export async function setOrderMetafield(
  orderId: string,
  key: string,
  value: string,
  type = 'json',
): Promise<void> {
  const data = await shopifyGraphQL<{
    metafieldsSet: { userErrors: { field?: string[] | null; message: string }[] };
  }>(
    `mutation SetMetafield($metafields: [MetafieldsSetInput!]!) {
       metafieldsSet(metafields: $metafields) {
         metafields { id }
         userErrors { field message }
       }
     }`,
    { metafields: [{ ownerId: orderId, namespace: 'oka', key, value, type }] },
  );
  assertNoUserErrors(data.metafieldsSet, 'metafieldsSet');
}

// ── Order editing (real Shopify order edits — these appear on the timeline) ──

export type CalculatedOrder = {
  id: string;
  lineItems: {
    nodes: { id: string; quantity: number; title: string; hasStagedLineItemDiscount?: boolean }[];
  };
};

export async function orderEditBegin(orderId: string): Promise<CalculatedOrder> {
  const data = await shopifyGraphQL<{
    orderEditBegin: {
      calculatedOrder: CalculatedOrder | null;
      userErrors: { field?: string[] | null; message: string }[];
    };
  }>(
    `mutation EditBegin($id: ID!) {
       orderEditBegin(id: $id) {
         calculatedOrder {
           id
           lineItems(first: 100) { nodes { id quantity title } }
         }
         userErrors { field message }
       }
     }`,
    { id: orderId },
  );
  assertNoUserErrors(data.orderEditBegin, 'orderEditBegin');
  const co = data.orderEditBegin.calculatedOrder;
  if (!co) throw new ApiError('shopify', 200, 'orderEditBegin returned no calculated order');
  return co;
}

export async function orderEditSetQuantity(
  calculatedOrderId: string,
  calculatedLineItemId: string,
  quantity: number,
): Promise<void> {
  const data = await shopifyGraphQL<{
    orderEditSetQuantity: { userErrors: { field?: string[] | null; message: string }[] };
  }>(
    `mutation SetQty($id: ID!, $lineItemId: ID!, $quantity: Int!) {
       orderEditSetQuantity(id: $id, lineItemId: $lineItemId, quantity: $quantity, restock: true) {
         calculatedOrder { id }
         userErrors { field message }
       }
     }`,
    { id: calculatedOrderId, lineItemId: calculatedLineItemId, quantity },
  );
  assertNoUserErrors(data.orderEditSetQuantity, 'orderEditSetQuantity');
}

export async function orderEditAddVariant(
  calculatedOrderId: string,
  variantId: string,
  quantity: number,
): Promise<void> {
  const data = await shopifyGraphQL<{
    orderEditAddVariant: { userErrors: { field?: string[] | null; message: string }[] };
  }>(
    `mutation AddVariant($id: ID!, $variantId: ID!, $quantity: Int!) {
       orderEditAddVariant(id: $id, variantId: $variantId, quantity: $quantity, allowDuplicates: false) {
         calculatedOrder { id }
         userErrors { field message }
       }
     }`,
    { id: calculatedOrderId, variantId, quantity },
  );
  assertNoUserErrors(data.orderEditAddVariant, 'orderEditAddVariant');
}

export async function orderEditCommit(calculatedOrderId: string, note: string): Promise<void> {
  const data = await shopifyGraphQL<{
    orderEditCommit: { userErrors: { field?: string[] | null; message: string }[] };
  }>(
    `mutation Commit($id: ID!, $note: String) {
       orderEditCommit(id: $id, notifyCustomer: false, staffNote: $note) {
         order { id }
         userErrors { field message }
       }
     }`,
    { id: calculatedOrderId, note },
  );
  assertNoUserErrors(data.orderEditCommit, 'orderEditCommit');
}

export async function cancelShopifyOrder(orderId: string, reason = 'OTHER'): Promise<void> {
  const data = await shopifyGraphQL<{
    orderCancel: {
      orderCancelUserErrors: { field?: string[] | null; message: string }[];
    };
  }>(
    `mutation CancelOrder($id: ID!, $reason: OrderCancelReason!) {
       orderCancel(
         orderId: $id
         reason: $reason
         refund: false
         restock: true
         notifyCustomer: false
         staffNote: "Cancelled from the OKA Warehouse app"
       ) {
         job { id }
         orderCancelUserErrors { field message }
       }
     }`,
    { id: orderId, reason },
  );
  const errs = data.orderCancel?.orderCancelUserErrors ?? [];
  if (errs.length) {
    throw new ApiError('shopify', 200, `orderCancel: ${errs.map((e) => e.message).join('; ')}`);
  }
}
