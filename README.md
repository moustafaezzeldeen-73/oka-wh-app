# OKA Warehouse

Warehouse app for OKA Egypt, built with Expo SDK 57 (React Native 0.86) and
testable in Expo Go on Android and iPhone.
It is a faithful implementation of the OKA Warehouse design, wired end to end to
live **Shopify Admin**, **J&T Express** and **Bosta** data. There is no mock data anywhere in the app.

## What it does

| Screen | Purpose |
| --- | --- |
| **Orders** | Live open orders, each joined to its J&T or Bosta parcel and tagged with the courier. Search by order, AWB, phone, city or courier; filters for ready, bad address, cancelled, not called, not answered, answered, ready for pickup, Bosta and J&T. A courier's reported delivery problem, or a COD that differs from Shopify, shows on the row. Arabic ⇄ English toggle. |
| **Scan** | Live camera barcode scanner (Code 128 / 39 / EAN / QR / ITF-14). Resolves a J&T AWB (`JEG…`), a Bosta AWB or an order name and opens the order. |
| **Order detail** | AWB and courier, tracking phase, J&T delivery problems with the courier's note and photos, COD-mismatch warning with a one-tap fix, customer card, Bosta ranking and address-clarity scores, call / WhatsApp / photo / edit actions, contact history, line items with real product images, delivery address, COD breakdown, attached photos. |
| **Edit order** | Change quantities, add products from the live catalogue, correct the delivery address. Commits a real Shopify order edit, then moves the courier's COD to Shopify's new balance — Bosta by COD update, J&T by resubmitting the order with its item list rebuilt. Locked once the courier holds the parcel. |
| **Tracking** | Five-phase timeline with real timestamps from the courier, the delivering courier with call and WhatsApp actions, the J&T branch line, and J&T's full scan history with signature / proof-of-delivery photos and delivery codes. |
| **Modes** | Truck-loading and shipping-status entry points, plus a live shift summary. |
| **Shipping status** | Phone-number lookup showing the shipment stage and courier. |
| **Truck loading** | Pick the truck first — **J&T**, **Bosta** or **In-house** — then burst scan with beep and haptics, running count, undo. On a J&T or Bosta truck, a parcel booked with another courier (or none) is refused with a red flash and the reason. The in-house truck takes everything: an order without a courier is tagged `oka-inhouse` (out for delivery), while a J&T or Bosta parcel rerouted to OKA's own delivery under its same AWB only gets a note on the Shopify order — its courier and AWB are left as they are. An order-number field covers parcels without a label. Each load is logged onto its Shopify order. |
| **Call** | Places the call, records it, then captures the outcome and attaches the recording to the order. |
| **Photo** | Camera capture, uploaded to Shopify Files, added to the order's pinned **Warehouse photos** field (thumbnails on the Shopify order page) and linked from the order log. Each shot shows uploading / saved / failed-with-reason, and a failed one retries on tap. Photos show on the order detail and open full screen. |
| **Mark delivered** | For in-house deliveries: enter what the delivery cost (saved to the pinned **In-house delivery cost** field), optionally record the courier's cash as paid in Shopify, and the order is tagged `oka-delivered`, logged, and — with the optional fulfillment permissions — marked fulfilled with carrier "OKA In-house". |
| **WhatsApp** | Message templates populated from the live order, for the customer or the courier. |

## How Shopify and the couriers are joined

OKA now ships with **J&T Express** and older parcels are still with **Bosta**, so
every order is matched to whichever courier carries it:

1. **The Shopify fulfillment.** When an order ships, its fulfillment gets a
   tracking entry — company `J&T Express` with a `JEG…` AWB, or `Bosta` with a
   numeric one. That entry decides the courier and the AWB.
2. **Booked but not yet fulfilled.** J&T parcels carry `txlogisticId`
   `SHOPIFY<order number>`, and Bosta parcels carry `businessReference` = the
   order name (`#2623721`). Both are looked up, live parcels win over
   cancelled or returned ones, then the newest.

| Field in the app | Source |
| --- | --- |
| Order name, line items, product images, subtotal, shipping, balance owed | Shopify |
| Courier and AWB | Shopify fulfillment tracking |
| COD, shipment state, courier, attempts | J&T `getOrders` + `logistics/trace` / Bosta delivery |
| Tracking phases and timestamps | J&T scans / Bosta `timeline` |
| Delivery problems, proof-of-delivery photos | J&T scans |
| Customer ranking, address clarity | Bosta only |

Orders on no courier yet show as **New**. A courier without keys, or one that
fails to answer, is named in a banner above the list; its orders still show the
AWB from Shopify, just without live status.

## Logging to the Shopify order

Every action — calls, recordings, photos, edits, address fixes, scans, status
changes, cancellations — is written back to the Shopify order.

Shopify's public Admin API has **no mutation for posting an order timeline
comment**: `commentApprove` / `commentDelete` / `commentNotSpam` / `commentSpam`
are blog comments, and there is no `commentEventCreate`. So the log is persisted
the ways that *are* public and merchant-visible:

1. **`oka.activity_log` metafield** — the complete structured record
   (kind, timestamp, actor, duration, call outcome, media URL), append-only.
2. **Pinned order fields** — `oka.photos` (Warehouse photos, a list of image
   files the admin shows as thumbnails) and `oka.delivery_cost` (In-house
   delivery cost). Shopify's API has no way for an app to post to the order
   timeline itself — only staff can comment there — so these fields are how
   photos appear on the order page.
3. **The order note** — a readable journal rendered on the order page. Each write
   also produces a real entry on the order timeline
   (*"… added a note to this order."* — verified against the live store).
   Merchant-written text above the log marker is preserved, and the journal is
   capped so it never exceeds Shopify's 5000-character note limit; overflow stays
   in the metafield and the note says so.
4. **Shopify Files** — photos and call recordings are uploaded via
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
cp .env.example .env      # fill in your Shopify, J&T and Bosta keys
npm run verify            # confirm credentials, scopes and the courier joins
npx expo start --tunnel   # then scan the QR code with Expo Go (Android or iPhone)
```

In a GitHub Codespace use `npm run start:codespace` instead. It prints a QR
code only once the address behind it really answers:

1. **GitHub's forwarded address first.** Metro starts on port 8081 with every
   Expo URL pointing at `https://<codespace>-8081.app.github.dev`, the port is
   made public (Expo Go can't sign in to GitHub), and the QR code
   (`exps://…`) appears when that address answers from outside. The script
   keeps checking it and puts the port back to public if GitHub drops it.
2. **Expo's tunnel if that fails.** GitHub's address can answer 404 or 502
   after a Codespace restart. If it still isn't working after 45 s, the
   script restarts Metro with Expo's ngrok tunnel (`@expo/ngrok` is a dev
   dependency, so there is nothing to install) and prints that QR code
   (`exp://….exp.direct`) once the tunnel answers.

It also stops a leftover app server still holding port 8081 from an earlier
run. `npm run start:codespace -- --tunnel` skips straight to the tunnel.
Expo runs headless (`EXPO_UNSTABLE_HEADLESS=1`), which stops React Native from
preparing its desktop DevTools window — that needs GUI libraries a Codespace
doesn't have (`libatk-1.0.so.0`). In that mode Expo prints no QR code or
keyboard shortcuts of its own; the script prints the QR code.

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

**J&T** needs four values from the J&T Egypt Open Platform — `JT_API_ACCOUNT`,
`JT_PRIVATE_KEY`, `JT_CUSTOMER_CODE`, `JT_CUSTOMER_PASSWORD` — the same ones the
J&T connector (`jt-mcp-server`) runs with. Every request is signed with J&T's
MD5 digests, computed in plain TypeScript (`src/api/md5.ts`) because React
Native has no crypto module; the tests check them byte for byte against the
connector's implementation. **Bosta** needs `BOSTA_API_KEY`. Either courier can
be left out.

For a wider rollout, set `API_PROXY_URL` to your own backend: every client then
tunnels through it (`/shopify`, `/bosta`, `/jt`) and **no credentials are bundled into the
app at all**. Screen code is unchanged either way. With direct access, the client
secret ships inside the app bundle, so anyone with the build can mint tokens for
the store until the secret is rotated. That is a reasonable trade for testing
and a small internal fleet; Shopify's own guidance is to keep the secret
server-side, which is what the proxy path is for.

## Tests

```bash
npm test          # typecheck + 294 logic and OAuth tests
npm run verify    # live API checks against the real accounts
npm run check:jt  # just the J&T keys (add AWBs to also read those parcels)
npm run bundle:android
```

`scripts/test-logic.ts` runs against **payloads captured from the live Shopify,
J&T and Bosta APIs**, so a schema change on any side surfaces as a failing test
(J&T fixtures keep the live structure with customer and courier details
replaced). It covers J&T request signing, the courier joins, state and timeline
mapping for both couriers, J&T problems and returns, COD mismatches, J&T update
payloads, edit locking, Egyptian phone normalisation, note rendering and
truncation, metafield round-tripping, and every list filter.

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
- J&T stamps scans and orders in **Cairo wall-clock time with no zone**
  (`2026-09-22 13:42:44`); the app converts them with the Africa/Cairo zone,
  summer time included.
- J&T has no edit call: a COD or address change resubmits the entire order with
  `operateType: 2` and the same `txlogisticId`, and is refused after pickup.
  J&T echoes phone numbers back as `+20-0102…`; that prefix is stripped before
  resubmitting.
- J&T's date-range order query is not enabled for OKA's account, so parcels are
  always looked up by AWB or by `SHOPIFY<n>` (20 per call, checked live).
- J&T scan codes on OKA's parcels: 10 pickup, 50 departed, 92 arrived,
  94 out for delivery, 100 signed, 110 problem. The courier's name and phone
  come from the scan text; a problem scan carries J&T's reason, the courier's
  note and photos.
