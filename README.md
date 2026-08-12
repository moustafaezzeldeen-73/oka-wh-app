# OKA Warehouse

Android warehouse app for OKA Egypt, built with Expo SDK 54 and testable in Expo Go.
It is a faithful implementation of the OKA Warehouse design, wired end to end to
live **Shopify Admin** and **Bosta** data. There is no mock data anywhere in the app.

## What it does

| Screen | Purpose |
| --- | --- |
| **Orders** | Live open orders, joined to their Bosta shipment. Search by order, AWB, phone or city; eight filters (ready, bad address, cancelled, not called, not answered, answered, ready for pickup). Arabic ⇄ English toggle. |
| **Scan** | Live camera barcode scanner (Code 128 / 39 / EAN / QR / ITF-14). Resolves an AWB or order name against Bosta then Shopify and opens the order. |
| **Order detail** | AWB with a barcode derived from the tracking number, tracking phase, customer card, Bosta customer ranking and address-clarity scores, shipping fee, call / WhatsApp / photo / edit actions, contact history, line items with real product images, delivery address, COD breakdown, attached photos. |
| **Edit order** | Change quantities, add products from the live catalogue, correct the delivery address. Commits a real Shopify order edit and re-syncs Bosta's COD. Locked once Bosta holds the parcel. |
| **Tracking** | Five-phase timeline with real timestamps from Bosta, plus the assigned courier with call and WhatsApp actions. |
| **Modes** | Truck-loading and shipping-status entry points, plus a live shift summary. |
| **Shipping status** | Phone-number lookup showing the shipment stage and courier. |
| **Truck loading** | Burst scan with beep and haptics, running count, undo. Each scan is logged onto its Shopify order. |
| **Call** | Places the call, records it, then captures the outcome and attaches the recording to the order. |
| **Photo** | Camera capture, uploaded to Shopify Files and linked from the order log. |
| **WhatsApp** | Message templates populated from the live order, for the customer or the courier. |

## How the two systems are joined

Bosta's `businessReference` carries the Shopify order name (`#2623721`), and that
is the join key. From each side:

| Field in the app | Source |
| --- | --- |
| Order name, line items, product images, subtotal, shipping | Shopify |
| AWB, COD, shipment state, courier | Bosta |
| Customer ranking | Bosta `receiver.ranking` |
| Address clarity, bad-address flag | Bosta `dropOffAddress.addressClarityScore` / `isBadAddress` |
| Tracking phases and timestamps | Bosta `timeline` |

Orders with no Bosta shipment yet are shown as **New** rather than hidden.

## Logging to the Shopify order

Every action — calls, recordings, photos, edits, address fixes, scans, status
changes, cancellations — is written back to the Shopify order.

Shopify's public Admin API has **no mutation for posting an order timeline
comment**: `commentApprove` / `commentDelete` / `commentNotSpam` / `commentSpam`
are blog comments, and there is no `commentEventCreate`. So the log is persisted
the three ways that *are* public and merchant-visible:

1. **`oka.activity_log` metafield** — the complete structured record
   (kind, timestamp, actor, duration, call outcome, media URL), append-only.
2. **The order note** — a readable journal rendered on the order page. Each write
   also produces a real entry on the order timeline
   (*"… added a note to this order."* — verified against the live store).
   Merchant-written text above the log marker is preserved, and the journal is
   capped so it never exceeds Shopify's 5000-character note limit; overflow stays
   in the metafield and the note says so.
3. **Shopify Files** — photos and call recordings are uploaded via
   `stagedUploadsCreate` → `fileCreate`, and the resulting CDN URL is linked from
   both of the above.

Line-item edits additionally go through `orderEditBegin` → `orderEditCommit`,
which Shopify itself records on the timeline as a genuine edit event.

## Call recording — what Android actually allows

Android does not let a third-party app capture the call's downlink audio; that is
a platform restriction, not something an app can work around. What this app does:

- requests the microphone, sets the audio session to stay active in the
  background, and records across the call while the dialer is in the foreground;
- on speaker, this captures **both** sides — the UI says so rather than implying
  a full-duplex tap;
- on **End call** it stops recording, asks for the outcome (answered / no answer /
  wrong number / refused), uploads the audio to Shopify Files, and writes the call
  and its recording to the order log.

If the microphone is denied, the call still goes through and is still logged —
just without audio.

## Setup

```bash
npm install
cp .env.example .env      # fill in your Shopify and Bosta keys
npm run verify            # confirm credentials, scopes and the Shopify↔Bosta join
npm start                 # then scan the QR code with Expo Go on Android
```

`npm run verify -- --write` additionally writes one log entry to a real order so
you can confirm the timeline entry appears in Shopify admin.

### Credentials

Keys live in `.env` (git-ignored) and reach the app through `app.config.js` →
`expo-constants`. See `.env.example` for the exact Shopify scopes required.

For a wider rollout, set `API_PROXY_URL` to your own backend: both clients then
tunnel through it (`/shopify`, `/bosta`) and **no credentials are bundled into the
app at all**. Screen code is unchanged either way. Bundling an Admin API token
into a handset is reasonable for a small internal fleet and standard practice for
this kind of tool, but it does mean anyone with the APK can read the store — the
proxy path exists for when that trade stops being acceptable.

## Tests

```bash
npm test          # typecheck + 94 logic tests
npm run verify    # live API checks against the real accounts
npm run bundle:android
```

`scripts/test-logic.ts` runs against **verbatim payloads captured from the live
Shopify and Bosta APIs**, so a schema change on either side surfaces as a failing
test. It covers the join, state and timeline mapping, edit locking, courier
resolution, Egyptian phone normalisation, note rendering and truncation, metafield
round-tripping, and every list filter.

## Notes from wiring this up against the live APIs

- `GET /deliveries/track/{awb}` **404s** on the Bosta v2 business API. The tracking
  timeline comes from `GET /deliveries/business/{awb}`, whose response carries a
  five-entry `timeline` array with `done` flags and dates.
- Bosta's *timeline* codes are not its *state* codes. Timeline runs
  `new(10) → picked_up(21) → in_transit(30) → out_for_delivery(41) → delivered(45)`,
  while `state.code` uses 24 for "Received at warehouse" and 30 for "In transit
  between hubs". The app prefers the timeline and falls back to state codes only
  for list payloads, which omit it.
- `POST /deliveries/search` ignores its date filters, so date narrowing is done
  client-side over descending pages.
- The parcel holder is the business account until a courier is assigned, so
  "courier" is only shown once the holder is neither the sender nor a
  `BUSINESS_*` role.
- Bosta refuses COD and address edits once the parcel is picked up, so the app
  locks those fields at the same point instead of letting an edit fail silently.
