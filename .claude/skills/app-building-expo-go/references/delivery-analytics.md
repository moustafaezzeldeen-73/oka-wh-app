# Delivery analytics for a COD shop: rates, reasons, places, money

How the OKA app answers "how many parcels arrive, why do the rest come back,
where, what do returns cost, and how much money came in and went out" from
live Shopify + J&T Express + Bosta data. Everything below was checked against
the live APIs (28 Sep 2026) before any UI was built.

Templates: `scripts/delivery-analytics.ts` (the pure rules),
`scripts/analytics-loader.ts` (fetching with injected API calls) and
`scripts/report.mjs` + `scripts/report-format.mjs` (the same report in the
terminal). They import the app's own `model` / `bostaState` / `jtState`
modules — adapt those imports.

## Contents
1. Definitions that hold up
2. Where each number comes from (verified fields)
3. Outcome rules per courier
4. Failure reasons: grouping live wording
5. Places: governorates and areas
6. Money in, money out
7. Loading a month without hitting rate limits
8. Screen, CLI and tests
9. Wrong turns

## 1. Definitions that hold up

- **One fact per Shopify order** created in the period (Cairo calendar days,
  `[from, to)`). Shopify is the source of truth for what was sold and which
  courier/AWB took it (fulfillment `trackingInfo`).
- **Outcome**: `delivered` · `failed` (returned, or on its way back) ·
  `active` (with the courier / on OKA's truck) · `waiting` (booked, not
  picked up) · `cancelled` (before pickup) · `unknown` (courier unreadable —
  never guess).
- **Rates use finished parcels only** (delivered + failed = "closed"). A
  7-day window is mostly in flight; always print the in-flight and waiting
  counts next to the rate so a 90 % "delivery rate" on 10 parcels isn't
  misread.
- **First-attempt rate** = delivered with attempts ≤ 1 / delivered with
  known attempts. **Average attempts** over finished parcels.
- **Why it failed** = the last customer-side reason before the return; also
  offer "every failed attempt", which catches courier-side trouble on
  parcels that were eventually delivered.
- **Stale** = booked with a courier more than 3 days ago, still not picked
  up. Shopify shows these as *fulfilled*, so nobody notices otherwise — the
  first live run found 5 such parcels on a single day.

## 2. Where each number comes from (verified fields)

| Need | Source | Fields |
| --- | --- | --- |
| Orders, value, payment type | Shopify bulk export | `currentTotalPriceSet`, `totalReceivedSet`, `totalRefundedSet`, `totalOutstandingSet`, `paymentGatewayNames` ("Cash on Delivery (COD)"), `displayFinancialStatus`, `cancelledAt`, `tags` |
| Courier + AWB | Shopify | `fulfillments { status createdAt trackingInfo { company number } }` |
| Governorate | Shopify | `shippingAddress.provinceCode` (ISO 3166-2:EG without `EG-`: `C`, `GZ`, `ALX`, `KB`…) |
| In-house cost | Shopify | `metafield(namespace:"oka", key:"delivery_cost")` |
| J&T status, freight, attempts | `POST /api/waybill/getWaybillInfo` `{customerCode, waybillNos}` (≤ 1000, header digest only) | `isSign` 1 signed by customer · 2 signed back by OKA (returned) · 0 neither; `totalFreight`, `freight`, `packageChargeWeight`, `numberOfDispatch`. AWBs not yet picked up are simply absent. |
| J&T reasons, returns in progress | `/api/logistics/trace` (≤ 30) | scans 110 problem (`probleDescription` "Abnormal parcelScan,<code>,<reason>,<note>"), 172 Returned parcel scan, 111 Return Sign, 120 Left Over (detention), 94/92/50/10 |
| J&T cash collected | `/api/order/getOrders` command 2 (≤ 20) | `itemsValue` — can differ from Shopify's balance |
| Bosta status, attempts, reasons | `POST /deliveries/search` (100/page, newest first) | `state.code` (45 delivered, 46 returned to business, 10 pickup requested), `type.code` 20 = "Return to Origin", `state.exception[] {reason, code, time, attemptType}`, `numberOfAttempts`, `dropOffAddress.city.name`, `cod` (**0 after a return**) |
| Bosta fees and settlement | `GET /deliveries/business/{awb}` only — the list has `pricing: {}` | `shipmentFees` (before VAT), `originalCod`, `wallet.cashCycle.{cod, bosta_fees (incl. 14 % VAT), shipping_fees, vat, deposited_amt}`, `wallet.cashout` |

Live magnitudes: J&T freight 62.70 – 163 EGP delivered; returns are charged
too, at a lower rate (43.89 – 71.98). Bosta: `shipmentFees` 76 →
`bosta_fees` 86.64 (76 × 1.14), charged on returns as well.

## 3. Outcome rules per courier

J&T (order of checks matters):
```ts
if (info?.isSign === 1) return 'delivered';
if (info?.isSign === 2) return 'failed';
if (scans.some(isReturnScan)) return 'failed';           // 172 / "return" / 退
if (scans.some((s) => s.scanTypeCode === 100)) return 'delivered';
if (info || scans.length || order?.orderStatus === 103) return 'active';
if (order?.orderStatus === 104) return 'cancelled';
return 'waiting';
```
Bosta:
```ts
const returning = d.type?.code === 20;                    // Return to Origin
const pickedUp = !!(d.state?.pickedUpTime || d.collectedFromBusiness);
if (code === 45 && !returning) return 'delivered';
if (code === 46 || returning) return 'failed';
if (code === 100 || code === 101) return 'failed';        // lost / damaged
if (/terminat|cancel/.test(value)) return pickedUp ? 'failed' : 'cancelled';
if (code < 20) return 'waiting';
return 'active';
```
In-house: tag `oka-delivered` → delivered (cash = `totalReceived`, cost =
`delivery_cost`), tag `oka-inhouse` → active. A courier parcel that was never
picked up but carries `oka-inhouse` went out on OKA's truck → in-house.

## 4. Failure reasons: grouping live wording

Normalise first (lower-case, fold أ/إ/آ→ا, ة→ه, ى→ي, strip diacritics,
Arabic-Indic digits), then first match wins — specific before generic:

| Bucket | Live phrasings |
| --- | --- |
| wanted to open | Bosta "Cancellation - the customer wants to open the shipment." |
| refused | J&T "Customer refuse by call", "Customer refuse by WhatsApp", "The goods do not match after opening" (1004); Bosta "Cancellation - the customer refuses to receive the shipment." (8); "رفض" |
| no answer / phone off | J&T "No Answer or Phone Switched Off" (202); Bosta "The mobile phone is off" (17); "العميل لا يرد" |
| not at the address | Bosta "Retry delivery - the customer is not in the address." (1) |
| address problem | J&T "Wrong or Undetailed Address Information"; Bosta "…changed the address." (2), "Waiting for data modification - address not clear" (13) |
| postponed | J&T "Change The Delivery Time"; Bosta "Postponed - …another day." (3); "تأجيل", "غدا" |
| courier error | J&T "Three-segment code error", "miss-sorting from DC" — J&T's own mistakes |
| cancelled, lost, other, none | the rest |

Rules that mattered:
- **J&T's structured reason beats the courier's note.** "Wrong or Undetailed
  Address Information — لايرد" is an address problem; use the note only when
  the reason is generic ("Other Kind Of Problems").
- **Skip the return leg.** J&T problem scans after the first return scan
  (172) and Bosta exceptions with `attemptType: "return"` are about the trip
  back to OKA, not the customer.
- Keep the courier's own wording as examples under each bucket — staff trust
  "Customer refuse by call — انا مش طالب اوردر اصلا" more than a label.
- Courier codes as fallback when the text is unknown (J&T 202/1004, Bosta
  1/2/3/4/8/13/17).

## 5. Places: governorates and areas

- **Governorate** from Shopify's `provinceCode` — consistent, unlike text.
  Fallbacks for orders without it: J&T `receiver.prov` (English *or* Arabic:
  "Cairo", "القاهرة", "أسيوط") and Bosta `dropOffAddress.city.name` with its
  own spellings: "Bani Suif", "El Kalioubia", "Behira", "Kafr Alsheikh",
  "Assuit", "Fayoum", "Sharqia". Keep an alias table per ISO code; index the
  normalised name with and without the leading "ال"; fold legacy codes (`SU`
  → Giza, `HU` → Cairo).
- **Area** from the free-text city, normalised: drop noise words (مدينه،
  مركز، محافظه، قريه، حي، city), a leading governorate name ("القاهرة مدينة
  نصر" → "نصر"), placeholders ("0") and cities that just repeat the
  governorate ("القاهره" in Cairo). Key areas by `gov:area`; list only areas
  with ≥ 3 finished parcels.
- **Ranking "worst"**: raw return rate puts 1/1 at the top. Sort by a
  smoothed rate `(failed + k·p) / (closed + k)` with k = 4 and p the overall
  return rate, and put places with **zero** returns last (smoothing alone
  ranked a 0/1 governorate above a 1/5 one). Show the raw rate and "failed of
  closed" beside it, plus what that place's returns cost.

## 6. Money in, money out

- **Money in**
  - cash collected on delivered parcels — the courier's figure: J&T
    `itemsValue`, Bosta `wallet.cashCycle.cod` or list `cod`; fall back to
    Shopify's outstanding balance and say how much came from Shopify;
  - in-house driver cash — recorded by marking the order paid, so
    `totalReceived` on delivered in-house COD orders;
  - online payments — `totalReceived` on non-COD orders, shipped or not.
- **Money out**
  - courier fees on every parcel the courier picked up, delivered or not
    (J&T `totalFreight`, Bosta `bosta_fees`);
  - in-house delivery costs;
  - refunds (`totalRefunded`).
- **Balance** = in − out. **Net due per courier** = collected − fees: what
  the courier should pay out.
- **Cash on the road** = COD value of active parcels.
- **Cost of returns** = fees on failed parcels. Also show "goods value that
  came back unsold": the COD value of failed parcels. That money isn't lost,
  but it's the sales the returns cost.
- **Unknown fees** on finished parcels (Bosta detail not read) are estimated
  at that courier's average for the period and labelled "estimated" —
  never silently dropped, never silently invented.

## 7. Loading a month without hitting rate limits

~40 orders a day → ~1200 a month.

- **Shopify: use a bulk export**, not paging. The order fields above cost
  ~13 points per order; 60 orders a page is ~800 points, so a bucket of
  1000 points refilling at 50–100 a second allows about one page every
  8–16 seconds. A month would take minutes. `bulkOperationRunQuery` → poll
  `node(id) { ... on BulkOperation { status url errorCode } }` → download
  the JSONL from the signed Google Cloud Storage link (no Shopify headers).
  A day completed in seconds. A completed export with no orders has `url:
  null`. Filter rows by `createdAt` locally as well.
  ```graphql
  mutation($q: String!) { bulkOperationRunQuery(query: $q) { bulkOperation { id status } userErrors { message code } } }
  ```
  where `$q` is `{ orders(query: "created_at:>='<ISO>' AND created_at:<'<ISO>'", sortKey: CREATED_AT) { edges { node { … } } } }`.
- **J&T**:
  - one `getWaybillInfo` call per 1000 AWBs gives status, freight and attempts;
  - `trace` (30 a call) only for parcels not yet signed for;
  - `getOrders` (20 a call) only for delivered parcels;
  - treat `999001030 "waybillNos size…"` as "nothing found" on every endpoint.
- **Bosta**:
  - page the search list newest-first and stop once it's older than the
    period minus 5 days (its date filter is ignored);
  - then call the single-delivery endpoint for finished parcels, for their
    fees. Each response is about 70 KB, so cap the number read (120) and
    cache finished parcels, because their fees never change.
- **Inject the API calls** (`shopify`, `download`, `jt.call`, `bosta`) so
  the phone and `npm run report` run the same loader, and tests can assert
  the exact batching against fake APIs.
- Report progress per step ("Reading J&T parcels (3/12)"). A load takes
  seconds to a minute.

## 8. Screen, CLI and tests

- **Screen**, top to bottom:
  - period pills (7 / 14 / 30 days, this month, last month);
  - headline rates with the "based on N finished · M on the way" line;
  - the stale-parcel alert;
  - a dark money card: balance, then in and out rows (non-zero only), cash
    on the road, and notes on estimates;
  - cost of returns;
  - couriers side by side (delivered %, returned %, net due);
  - reasons, with a toggle between "last reason" and "all attempts";
  - worst places, with a governorates / areas toggle.

  Cache each period's report in memory and add a refresh button.
- **CLI**: `npm run report [-- --period 7d|14d|30d|month|lastMonth]
  [--from D --to D] [--csv parcels.csv] [--json r.json]`.
  - Set `process.env.TZ = 'Africa/Cairo'` first, so days are Cairo days in a
    UTC Codespace.
  - Write the CSV with a UTF-8 BOM so Excel shows Arabic cities.
  - Git-ignore `*.csv` and `report*.json`.
- **Tests**:
  - fixtures from the live payloads (anonymise AWBs, ids, courier names and
    phones, payout amounts);
  - every live reason phrasing mapped to its bucket;
  - every courier spelling mapped to its governorate;
  - outcome rules;
  - a hand-computed `summarize`;
  - the loader against fake sources, asserting which calls are made with
    which AWBs, and that a courier outage becomes "unknown" plus a warning.

## 9. Wrong turns

- `created_at:<2026-09-20` let 20 September's orders through: a bare date
  compares by day in the shop's zone. Use full ISO timestamps.
- JavaScript `\b` treats Arabic letters as non-word characters, so
  `/\b(مدينه)\b/` never matches. Use `(^|\s)(…)(?=\s|$)`.
- Deciding "picked up" with `state.code >= 20` made Bosta parcels
  terminated before pickup count as failures, because terminal codes are
  ≥ 20 too. Use `pickedUpTime` / `collectedFromBusiness`.
- The J&T docs suggested the date-range query (getOrders command 3) might
  be permission-gated, and I repeated that as fact. It works: at most 7
  days, `current` / `size`, 100 a page. Test before writing a limitation
  down.
- I summed the expected test totals by hand and got them wrong. When a test
  fails, recheck the expectation as well as the code.
- **Run the rules on one real day before building the screen.** The MCP
  connectors covered the whole path: the Shopify bulk export, J&T waybill,
  trace and order lookups, and the Bosta list and detail. That run found:
  - the J&T "courier error" and "Change The Delivery Time" wording;
  - a city field that repeats the governorate;
  - the smoothing-order bug;
  - the never-picked-up parcels.
