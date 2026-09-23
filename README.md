# OKA Warehouse

Warehouse app for OKA Egypt, built with Expo SDK 57 (React Native 0.86) and
testable in Expo Go on Android and iPhone.
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

## Call recordings and transcripts

An ordinary app can't record a phone call, but most Android phones sold in
Egypt record every call themselves (Samsung, Xiaomi, and Google's Phone app)
and save it as an audio file. The app builds on that:

1. **Start call** opens the dialer; the phone's recorder captures the call.
2. **End call**, then pick the outcome (answered / no answer / wrong number /
   refused).
3. The app finds the phone's recording of that call — the newest audio file
   created since the call started, preferring one whose filename contains the
   number — and shows it for confirmation. In a real Android build this is
   automatic (`READ_MEDIA_AUDIO`, audio only). In Expo Go and on iPhone,
   **Choose file** opens the system file picker instead, since Expo Go can't be
   granted media access on Android.
4. The recording is uploaded to Shopify Files as
   `oka-<order>-<awb>-<customer|courier>-<YYYYMMDD-HHmm>.<ext>` (the original on
   the phone is untouched) and, in parallel, transcribed by Gemini
   (`gemini-2.5-flash` by default) in Egyptian Arabic with speaker labels. The
   order's product names and the customer's name go in the prompt, so they
   come back spelled right.
5. The order log gets the call with its outcome, duration, the one-line Arabic
   summary and a link to the recording. The full transcript is uploaded as a
   `.txt` next to the recording and linked, rather than stored in the log,
   because JSON metafields are capped at 128 KB from API 2026-04 on.

Nothing blocks the call from being logged: a failed upload, a missing Gemini
key, a format Gemini can't read (AMR, 3GP) or a recording over ~14 MB each
become a visible line in the order log instead. The app itself no longer asks
for microphone access.

## Setup

```bash
npm install
cp .env.example .env      # fill in your Shopify and Bosta keys
npm run verify            # confirm credentials, scopes and the Shopify↔Bosta join
npx expo start --tunnel   # then scan the QR code with Expo Go (Android or iPhone)
```

In a GitHub Codespace use `npm run start:codespace` instead. It skips Expo's
ngrok tunnel, which can stall before any QR code appears, and serves Metro
through the Codespace's own forwarded address for port 8081:

1. It starts Metro with every Expo URL pointing at
   `https://<codespace>-8081.app.github.dev`.
2. It makes port 8081 public, because Expo Go can't sign in to GitHub. If that
   fails, it asks you to do it in the **Ports** tab: right-click 8081 →
   **Port Visibility** → **Public**.
3. Once the address answers from outside, it prints a QR code for
   `exps://<codespace>-8081.app.github.dev`. Scan it with the phone camera.
   Ignore the `exp://…:443` address Expo prints itself.

`npm run start:codespace -- --tunnel` uses the ngrok tunnel instead. Either way
it sets `EXPO_UNSTABLE_HEADLESS=1`, which stops React Native from preparing
its desktop DevTools window. That window needs GUI libraries a Codespace
doesn't have, and without the flag Metro prints a harmless
`libatk-1.0.so.0: cannot open shared object file` error.

`npm run verify -- --write` additionally writes one log entry to a real order so
you can confirm the timeline entry appears in Shopify admin.

### Credentials

Keys live in `.env` (git-ignored) and reach the app through `app.config.js` →
`expo-constants`.

**Shopify** no longer lets merchants create custom apps in the admin, so there is
no permanent `shpat_` token to paste in. Create the app in the
[Dev Dashboard](https://dev.shopify.com) instead: select the scopes listed in
`.env.example` on the app's version, release it, install it on the store, then
copy the **Client ID** and **Client secret** from the app's Settings into
`SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET`. The app exchanges them for an
access token (client credentials grant), caches it, and mints a fresh one before
the 24-hour expiry — nothing to renew by hand. The app and the store must belong
to the same Dev Dashboard organization, or Shopify answers `shop_not_permitted`.

```bash
npm run shopify:token                 # check the Client ID + secret and the scopes
npm run shopify:token -- --permanent  # one-time browser approval → permanent shpat_ token
```

`--permanent` runs the authorization code grant: it prints an approval link,
verifies Shopify's signature on the redirect, exchanges the code for a
non-expiring `shpat_` token, and saves it to `.env` as
`SHOPIFY_ADMIN_ACCESS_TOKEN`. With a token set, the app uses it and the Client
secret is no longer bundled. The redirect URL (`https://example.com/callback` by
default) must be registered on the app version in the Dev Dashboard.

For a wider rollout, set `API_PROXY_URL` to your own backend: both clients then
tunnel through it (`/shopify`, `/bosta`) and **no credentials are bundled into the
app at all**. Screen code is unchanged either way. With direct access, the client
secret ships inside the app bundle, so anyone with the build can mint tokens for
the store until the secret is rotated. That is a reasonable trade for testing
and a small internal fleet; Shopify's own guidance is to keep the secret
server-side, which is what the proxy path is for.

## Tests

```bash
npm test          # typecheck + 158 logic and OAuth tests
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
