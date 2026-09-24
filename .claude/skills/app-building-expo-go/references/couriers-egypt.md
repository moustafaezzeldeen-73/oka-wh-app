# Courier APIs: J&T Express Egypt and Bosta

Both were integrated into one app. Confirm every shape against live data
(the J&T / Bosta MCP connectors are the quickest way) before coding.

## Joining orders to parcels
1. Shopify fulfillment `trackingInfo.company` + `number` decides courier and
   AWB (J&T AWBs look like `JEG000534521595`; Bosta's are 6–12 digits).
2. Booked but not yet fulfilled: J&T `txlogisticId = "SHOPIFY<order number>"`,
   Bosta `businessReference = "#<order number>"`.
3. When both exist, prefer live over cancelled/returned, then newest.
4. When a courier's API can't be read, still show the AWB from Shopify and
   mark it "Booked" — and refuse actions that depend on the courier's state
   (e.g. rerouting) rather than guessing.

## J&T Express Egypt Open Platform
Base: `https://openapi.jtjms-eg.com/webopenplatformapi` (sandbox:
`demoopenapi…`). Credentials: apiAccount, privateKey, customerCode (= the
login username, `J00…`), customer password.

**Signing** (React Native has no crypto — ship a small pure-TS MD5 and test it
against `node:crypto`):
- Body: `application/x-www-form-urlencoded`, one field `bizContent=<json>`,
  encoded exactly like `URLSearchParams` (space → `+`, also encode `!'()~`).
- Header `digest` = Base64(MD5(bizContentJson + privateKey)); headers
  `apiAccount`, `timestamp` (ms).
- Order create/cancel/query also put `customerCode` and a business `digest`
  first in bizContent: Base64(MD5(customerCode +
  UPPER(HEX(MD5(password + "jadada236t2"))) + privateKey)). Tracking must NOT
  carry them.

**Responses:** success is the string `code: "1"`; error codes may arrive as
**numbers** — compare with `String(code)`. An order query that matches
nothing returns `999001030 "参数无效:waybillNos size must be between 1 and
1000"` instead of `[]` — treat it as empty, or the app shows a false outage
and a key check reports "rejected keys".

**Endpoints used:**
- `/api/order/getOrders` `{command: 1|2, serialNumber: [...]}` — by
  txlogisticId or AWB; 20 per call verified live. Date-range (command 3) was
  permission-gated for this account.
- `/api/logistics/trace` `{billCodes: "a,b"}` — up to 30.
- `/api/order/cancelOrder` `{txlogisticId, reason ≤50, orderType}` — use the
  `orderType` J&T returned ("2" here).
- `/api/order/addOrder` with `operateType: 2` and the **full** payload to
  change COD / address / description — no edit endpoint; refused after
  pickup. J&T echoes phones as `+20-0102…`; strip `^\+\d{1,3}-` before
  resubmitting. Rebuild `pickInfo` (items, net unit prices, subtotal,
  post-edit shipping, COD) and rewrite the COD in `remark`.

**Data meanings:**
- Times are **Cairo wall-clock with no zone** ("2026-09-22 13:42:44").
  Convert with `Intl` `Africa/Cairo` (DST included); cache the formatter —
  constructing one per scan is slow on Hermes.
- `orderStatus`: 100 unassigned, 101 assigned to branch, 102 assigned to
  courier, 103 picked up, 104 cancelled. Locked (no edits) once ≥103 or any
  scan exists.
- Scan codes seen: 10 pickup, 50 departed, 92 arrived, 94 out for delivery,
  100 signed (with `sigPicUrl`, `electronicSignaturePicUrl`, `otp`), 110
  problem (`probleDescription` = "Abnormal parcelScan,<code>,<reason>,<courier
  note>", `problemPicUrl` comma-separated). Returns: text contains "return"
  or `退`.
- Courier name/phone live in the scan text: `J&T courier NAME(0100…)`; take
  them from delivering/signing scans, not pickup. Branch phone:
  "branch‘s phone number：01003011680|Name" (skip all-zero numbers).
- A problem is "open" only if it's the newest scan.
- Photo links are signed and expire (~7 days) — fetch fresh, don't store.

## Bosta v2
- Auth header `Authorization: <raw key>` (no Bearer).
- `POST /deliveries/search` ignores its date filters — paginate newest-first
  and stop locally.
- `GET /deliveries/track/{awb}` 404s on the business API; use
  `GET /deliveries/business/{awb}` whose `timeline` has five entries
  (new 10 → picked_up 21 → in_transit 30 → out_for_delivery 41 →
  delivered 45) with `done` flags. Timeline codes ≠ `state.code` (24
  "received at warehouse", 30 "in transit between hubs", ≥46 terminal).
- Edits: `PUT /deliveries/business/{id}` (plain `/deliveries/{id}` 404s).
  COD `{cod}`; AWB contents in
  `specs.packageDetails.{description,itemsCount}` — resend the current
  `specs` merged with the change in case Bosta replaces nested objects; if a
  combined update fails, still push the COD alone. Refused once picked up
  (`state.code ≥ 20`).
- The holder is the business account until a courier is assigned; only show
  a courier when the holder is neither the sender nor a `BUSINESS_*` role.

## Money safety
- Flag courier COD ≠ Shopify balance on non-delivered parcels, with a
  one-tap "set courier COD to the Shopify amount" while still editable. This
  caught a live parcel collecting 411 EGP for a 496 EGP order.
- Don't change live shipments (COD, cancel) on your own initiative from a
  chat — surface the mismatch and let the user decide.
