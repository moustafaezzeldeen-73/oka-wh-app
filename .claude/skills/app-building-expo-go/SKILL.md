---
name: app-building-expo-go
description: Hard-won playbook for building, running and testing React Native / Expo apps in Expo Go — especially from a cloud dev environment (GitHub Codespaces, a remote container, a Claude cloud sandbox) onto a real iPhone or Android phone — and for wiring such apps to live Shopify Admin and courier APIs (J&T Express Egypt, Bosta). Includes the known-good Expo Go SDK 57 build (exact package versions, app.config.js, tsconfig, upgrade steps from older SDKs). Use it whenever someone builds, scaffolds or upgrades an Expo / React Native app, hits "Project is incompatible with this version of Expo Go", runs `expo start`, tests on Expo Go, asks "how do I run the app", reports that no QR code appears, Expo Go shows HTTP 404 or 502, a blank screen, a libatk / DevTools error, a keyboard covering an input, a button hidden under the tab bar, photos or uploads not saving, or integrates Shopify orders, metafields, files or courier AWBs/COD into a mobile app — even if they don't mention Expo Go by name.
---

# Building apps for Expo Go — the playbook

Lessons from building the OKA Warehouse app (Expo SDK 57, React Native 0.86,
Shopify + J&T + Bosta, tested on an iPhone through a GitHub Codespace). Every
section is something that went wrong at least once. Read the part that matches
the task; the reference files hold the detail.

| Situation | Read |
| --- | --- |
| Starting a new Expo Go app, checking/upgrading the SDK, exact working versions and config files | [references/expo-go-sdk-build.md](references/expo-go-sdk-build.md) |
| Getting the app onto a phone from a Codespace / remote box; any Expo Go error | [references/running-expo-go.md](references/running-expo-go.md) and `scripts/start-codespace.mjs` |
| Screens, keyboard, tab bars, uploads that "look saved", fonts, RTL | [references/rn-ui-pitfalls.md](references/rn-ui-pitfalls.md) |
| Shopify Admin API: auth, orders, metafields, files, fulfilment, COD | [references/shopify.md](references/shopify.md) |
| J&T Express Egypt or Bosta: signing, tracking, COD/AWB edits, joins | [references/couriers-egypt.md](references/couriers-egypt.md) |
| SDK upgrades, env/secrets, device features (camera, call recordings) | [references/expo-sdk-and-config.md](references/expo-sdk-and-config.md) |

## 1. Know which machine can reach what

Three places are involved and they see different networks:

- **Claude's sandbox** (where code is written) is usually blocked from the
  app's real hosts — `*.myshopify.com`, courier APIs, `*.app.github.dev`,
  ngrok — with "Host not in allowlist" / 403 / `connect_rejected`. Retrying
  won't help and copying credentials into another session to get around it is
  refused as credential leakage.
- **The user's dev box** (e.g. their Codespace) can reach everything.
- **The phone** reaches only public addresses.

So: verify live data through MCP connectors when they exist (Shopify, courier
connectors) — that is how real payload shapes, time zones and batch limits
were confirmed here — and for everything else ship **one-command check
scripts** the user runs (`npm run verify`, `npm run check:jt`) that print
plain ✓/✗ lines and name the fix. Design them so a blocked network is
reported as blocked, not as "keys rejected".

## 2. The run recipe that works (Codespace → iPhone)

What finally worked every time, after 404s, 502s and missing QR codes:

1. **Use Expo's tunnel, by default.** GitHub's forwarded port
   (`https://<codespace>-8081.app.github.dev`) looked cleaner but kept failing:
   it resets to private after a Codespace restart (→ 404), stays attached to a
   dead process (→ 502), and needs manual PORTS-tab fiddling. The user's
   verdict: "always use the tunnel because this is what only works".
2. **Install `@expo/ngrok` as a devDependency.** Expo otherwise asks to
   install it globally mid-run — and in non-interactive mode it cannot ask.
3. **Print the QR code yourself.** `EXPO_UNSTABLE_HEADLESS=1` (needed to
   silence the harmless `libatk-1.0.so.0` DevTools error in a GUI-less
   container) plus `expo start`'s always-on event log makes Expo
   non-interactive, and non-interactive Expo prints **no QR code at all**.
   Read the tunnel URL from ngrok's local API (`127.0.0.1:4040/api/tunnels`)
   rather than polling Expo's manifest, which logs a warning each time.
4. **Build the bundles before showing the QR code.** The first iOS/Android
   bundle takes a minute+ in a small container; proxies in front of Metro give
   up and Expo Go shows **502**. Fetch the manifest's `launchAsset.url`
   locally for each platform first; the phone's request then comes from
   Metro's cache (≈0.07 s instead of a full build).
5. **Free port 8081 first.** A leftover `expo start` from another terminal
   makes the new one move to 8082 while the address still points at 8081.
6. **Spawn the Expo CLI directly** (`node <expo/bin/cli> start …`), not via
   `npx`, so the script can stop and restart Metro cleanly.

`scripts/start-codespace.mjs` implements all of this; copy it into the
project as `npm run start:codespace` and adapt the port or messages.

End every reply that changes app code with the restart block the user asked
for, e.g.:

```bash
# press Ctrl+C if it's running
git pull
npm install
npm run start:codespace
```
…then wait for "iPhone bundle ready" → "Ready for Expo Go." and scan the new
QR code with the phone camera (not Expo Go's "Recently opened" list).

## 3. Symptom → cause → fix

| What the user sees | Usual cause | Fix |
| --- | --- | --- |
| `ERROR … installing React Native DevTools … libatk-1.0.so.0` | Metro prepares a desktop DevTools window; the container has no GUI libs | Harmless. `EXPO_UNSTABLE_HEADLESS=1` silences it (but see "no QR") |
| No QR code in the terminal | Non-interactive Expo (headless flag, `CI` set, or no TTY) never prints one; or the script waits for an address that never answers | Print it yourself once the address answers (the bundled script does) |
| Expo Go: "HTTP response error 404:" (empty body) | Old address from "Recently opened"; GitHub port not forwarded / reset | Scan the fresh QR; use the tunnel |
| Browser "page can't be found / 404" on `…app.github.dev/status` | GitHub isn't forwarding the port at all (a private port would show a login, not 404) | PORTS → Add Port, Public — or just use the tunnel |
| 502 | First bundle build too slow for the proxy; stale forward to a dead process; nothing listening | Warm bundles before the QR; free 8081; tunnel |
| Blank / endless spinner on launch | App gated on `useFonts` and a font failed | Render once `fontsLoaded || fontError` |
| `.env` value "works in scripts but not in the app" | Expo's `.env` loader treats unquoted `#` as a comment (`abc#def` → `abc`) | Quote it: `KEY="abc#def"`; make check scripts parse `.env` the same way (`node:util` `parseEnv`) |

## 4. Habits that saved time (and the wrong turns behind them)

- **Check the docs before asserting a limitation.** Early on I told the user
  their `shpss_` secret + client ID couldn't produce a token; the Shopify docs
  showed the client-credentials grant does exactly that. I also once claimed
  speakerphone recording captures both sides of a call — false. Look it up.
- **Let live data settle ambiguities.** J&T timestamps carry no zone; a scan
  stamped 14:31 existing at 14:12 UTC proved they are Cairo time. A J&T
  "rejected keys" error turned out to be its way of saying "no results".
- **Never let a failure look like success.** Optimistic thumbnails plus a
  2-second toast hidden behind a full-screen camera meant no photo ever
  uploaded and nobody noticed. Show per-item status and keep errors on screen.
- **Tests from live payloads, anonymised.** Capture real response shapes via
  MCP, but replace customer/courier names, phones, addresses and signed photo
  URLs before committing — repos are often public.
- **Secrets never in git — including commit messages and examples.** Keep
  keys in the git-ignored `.env`; grep staged diffs for key fragments before
  each commit; don't use a real password's prefix as an "example". Note that
  keys in `app.config.js` `extra` ship inside the app bundle and are served in
  the Expo manifest to anyone who has the dev-server URL.
- **`pkill -f` can kill your own shell.** When testing a script that runs
  `pkill -f 'expo start'`, the Bash tool's command line containing that text
  matches too. Put the test in a file and run `bash file.sh`, and match
  precisely (`node .*expo(/bin/cli)? start`).
- **Scope-gated fields don't belong in the main list query.** One field that
  needs a permission the app lacks fails the whole query and empties the app.
  Fetch such data separately and fail soft.
- **Ask for the terminal output early.** Several rounds of 404/502 guessing
  would have been one round with the last 20 terminal lines.
