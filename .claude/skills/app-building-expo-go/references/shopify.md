# Shopify Admin API from a mobile app — what held up and what didn't

API version used: 2026-07 (GraphQL). Validate every operation against the live
schema before shipping — the Shopify MCP `validate_graphql_codeblocks` tool
also lists the scopes each operation needs, which is how the scope traps
below were caught.

## Auth: Dev Dashboard apps
- Merchants can no longer create custom apps with a permanent `shpat_` in the
  admin. A **Dev Dashboard** app gives a Client ID + `shpss_` secret, and:
  - **Client credentials grant** — `POST https://<shop>/admin/oauth/access_token`
    with `grant_type=client_credentials` → a `shpat_` valid 24 h
    (`expires_in` 86399). Mint and refresh it in the app; share one in-flight
    exchange between concurrent callers; on 401, invalidate and retry once.
    Fails with `shop_not_permitted` if app and store are in different
    Dev Dashboard organizations.
  - **Authorization code grant** — for a non-expiring token: authorize URL →
    redirect (e.g. `https://example.com/callback`, registered on the app
    version) → verify `state`, `shop` and the HMAC (SHA-256 of the sorted
    query without `hmac`, keyed by the secret) → exchange the code.
- Wrong turn: I first told the user the `shpss_` + client ID "couldn't be
  used". Read the current "manage credentials" docs before saying no.
- The secret ends up in the app bundle when the device calls Shopify
  directly. Fine for testing; for rollout, a small proxy keeps it server-side.

## Scopes and the query that must never break
Needed here: `read_orders write_orders read_order_edits write_order_edits
read_products read_customers read_files write_files`. Optional:
`read/write_merchant_managed_fulfillment_orders` (mark fulfilled).
- Put **only** fields covered by guaranteed scopes in the main order-list
  query. Metafield `references` (needs `read_files`) or `fulfillmentOrders`
  (fulfillment scopes) in that query would fail the whole list if the scope is
  missing. Read the raw metafield `value` (just `read_orders`) and resolve
  files with a separate, fail-soft `nodes(ids:)` query.
- A photo feature failing silently was most likely a missing `write_files` —
  make the error say which scope to add, and have `npm run verify` probe
  `stagedUploadsCreate`.

## There is no API to post on the order timeline
Checked against the schema: no `commentEventCreate`, `timelineCommentCreate`,
`commentCreate` or `eventCreate` mutation. `CommentEvent` is read-only (staff
comments). So an "everything logged on the order" requirement is met with:
1. A JSON **metafield** log (`oka.activity_log`) — the complete record.
   JSON metafields cap at 128 KB (from API 2026-04); put long transcripts in
   Files and link them.
2. The **order note** as a readable journal (5000-char cap; preserve
   merchant text above a marker; trim oldest lines). Note updates show on the
   timeline as "added a note".
3. **Pinned metafield definitions** for things staff should see on the order
   page: `list.file_reference` (validation `file_type_options: ["Image"]`)
   renders image thumbnails; `number_decimal` for costs. Create them once with
   `metafieldDefinitionCreate` (`pin: true`, ownerType `ORDER`).

## Files (photos, recordings, transcripts)
`stagedUploadsCreate` (resource `IMAGE` or `FILE`, `httpMethod: POST`) →
multipart POST of the signed parameters *then* the file (React Native:
`form.append('file', { uri, name, type })`) → `fileCreate` with
`originalSource: resourceUrl` → poll `node(id)` until `MediaImage.image.url`
/ `GenericFile.url` appears (~a few seconds; give up ~30 s, keep the file id
and resolve the URL later). Return the file id as well as the URL.

## Order data traps
- `lineItem.quantity` is the **original** quantity; after an order edit use
  `currentQuantity` and drop lines at 0.
- `discountedUnitPriceSet` misses order-level / code discounts; use
  `discountedUnitPriceAfterAllDiscountsSet` for per-unit prices on invoices.
- COD = `totalOutstandingSet` (what's still owed), falling back to
  `currentTotalPriceSet`. After an edit, re-read the order and take Shopify's
  recalculated balance and shipping fee — don't recompute from list prices.
- Which courier carries an order: the fulfillment's
  `trackingInfo { company number }` ("J&T Express" / "Bosta"); skip
  cancelled fulfillments, newest first; fall back to AWB shape.
- `orderEditBegin` → `orderEditSetQuantity` / `orderEditAddVariant` →
  `orderEditCommit` (Shopify logs the edit on the timeline itself). Match
  calculated lines to real ones with care (title + current quantity).
- `orderMarkAsPaid` records collected cash — a money action; make it an
  explicit, default-off choice in the UI.
- `fulfillmentCreate` over open fulfillment orders with
  `notifyCustomer: false` and a tracking company (e.g. "OKA In-house"); treat
  a scope error as a note, not a failure.
- Tags drive simple app states well (`oka-ready`, `oka-inhouse`,
  `oka-delivered`) and are visible/searchable in the admin.
