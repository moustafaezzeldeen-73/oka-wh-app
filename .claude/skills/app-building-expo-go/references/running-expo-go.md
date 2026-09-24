# Running an Expo app in Expo Go from a remote dev box

Written from getting an Expo SDK 57 app from a GitHub Codespace onto an
iPhone. The user had no install rights on their own machine, so the
Codespace was the dev box.

## Contents
1. Ground rules for Expo Go
2. Routes to the phone, compared
3. What Expo does in non-interactive mode
4. The start script, step by step
5. Diagnosing from the phone and browser
6. Timeline of what went wrong (so you don't repeat it)

## 1. Ground rules for Expo Go

- The App Store / Play Store Expo Go runs **only the latest SDK**. If the
  project is older, upgrade the project (see expo-sdk-and-config.md) rather
  than hunting for old Expo Go builds.
- Expo Go opens `exp://host[:port]` over **HTTP** and `exps://host` over
  **HTTPS**. `exp://host:443` is plain HTTP to a TLS port — broken.
- Expo Go's "Recently opened" list keeps old addresses; tunnel and forwarded
  URLs change between runs. Always scan the fresh QR code.
- Expo Go's error screen "There was a problem running the requested project.
  HTTP response error 404:" shows the status code and a JSON `message` if
  any — an empty body tells you nothing about *who* answered. Metro itself
  answers almost every path with the manifest (tested: `/`, `/index.exp`,
  `/manifest`, even `/nope` return 200 with the `expo-platform` header), so a
  404 almost always comes from something in front of Metro.

## 2. Routes to the phone, compared

| Route | How | Verdict |
| --- | --- | --- |
| LAN (`expo start`) | Phone and Metro on the same network | Impossible from a cloud box |
| Expo tunnel (`--tunnel`, ngrok) | `exp://xxxx.exp.direct` | **What worked.** Needs `@expo/ngrok` (make it a devDependency). |
| GitHub Codespaces forwarded port | `EXPO_PACKAGER_PROXY_URL=https://<codespace>-8081.app.github.dev`, port 8081 public, QR `exps://…` | Worked once, then 404 (port reset to private / not forwarded after a Codespace restart) and 502 (stale forward, slow first bundle). Needs manual PORTS-tab steps; `gh codespace ports visibility 8081:public -c $CODESPACE_NAME` helps but can't create a missing forward. |
| Expo WS tunnel (`EXPO_UNSTABLE_TUNNEL_V2=1`) | `@expo/ws-tunnel` | Requires an Expo account login; not needed. |

Details for the GitHub route if you ever need it:
- Expo reads `EXPO_PACKAGER_PROXY_URL` from the **shell** environment
  (`getOriginalEnvValue`), not from `.env`.
- With the proxy URL set, the manifest's `launchAsset.url` and `hostUri`
  point at the proxy host with no port — correct for `exps://`.
- A private port answers a browser with a GitHub login redirect; a **404**
  page means GitHub isn't forwarding the port at all; **502** means it
  forwards but can't get a timely answer from the process.

## 3. What Expo does in non-interactive mode

`isInteractive = !shouldReduceLogs() && !env.CI && stdout.isTTY`, and
`shouldReduceLogs = !!logStream && EXPO_UNSTABLE_HEADLESS`. `expo start`
*always* installs an event log (`.expo/dev/logs/start.log`), so setting
`EXPO_UNSTABLE_HEADLESS=1` makes Expo non-interactive. Then it:

- prints `Waiting on http://localhost:8081` instead of the usual banner,
- prints **no QR code** and offers no keyboard shortcuts,
- cannot prompt (e.g. "install @expo/ngrok globally?") — the tunnel just fails.

That flag is still worth setting in a GUI-less container: without it Metro
tries to prepare React Native's standalone DevTools window
(`@react-native/debugger-shell`, Electron) and logs
`libatk-1.0.so.0: cannot open shared object file`. That error is harmless —
Metro and the app keep working — so the alternative is simply to leave the
flag off and ignore the message.

## 4. The start script, step by step

`scripts/start-codespace.mjs` (bundled with this skill):

1. **Free the port.** If something answers on 127.0.0.1:8081, `pkill -f
   'node .*expo(/bin/cli)? start'`, wait, and refuse to continue if the port
   is still taken.
2. **Start Metro with the tunnel**: `node <require.resolve('expo/bin/cli')>
   start --port 8081 --tunnel` with `EXPO_UNSTABLE_HEADLESS=1`.
3. **Wait for Metro**: poll `http://127.0.0.1:8081/status` for
   `packager-status:running`.
4. **Find the tunnel**: poll `http://127.0.0.1:4040..4045/api/tunnels` for the
   tunnel whose `config.addr` ends in `:8081`; take `public_url`'s host.
5. **Check it from outside**: `https://<host>/status` must say
   `packager-status:running`.
6. **Warm the bundles**: for `ios` and `android`, GET the manifest from
   `http://127.0.0.1:8081/` with headers `expo-platform: <p>` and
   `accept: application/expo+json,application/json`, take
   `launchAsset.url`, and fetch that path+query from 127.0.0.1. Print
   "iPhone bundle ready (N s)".
7. **Print the QR** for `exp://<host>` using Expo's own renderer
   (`@expo/cli/build/src/utils/qr.js` → `printQRCode(url).print()`), plus a
   "phone check" `/status` link for Safari.
8. `--github` opts into the forwarded-port route with a 45 s fallback to the
   tunnel, and a watcher that re-publics the port every 30 s.

Why the pieces matter, in one line each: stale servers cause 502s; npx
wrappers don't pass signals, so Metro survives restarts; ngrok's API avoids
Expo's per-poll "Tunnel URL not found" warning; warming avoids proxy timeouts;
Expo's QR renderer keeps the look familiar.

## 5. Diagnosing from the phone and browser

Ask the user for, in this order:
1. The **last 20 lines of the terminal** after `npm run start:codespace`.
2. What `https://<host>/status` shows in a browser: `packager-status:running`
   = Metro reachable; GitHub login = private port; 404 page = not forwarded /
   wrong address; 502 = nothing answering in time.
3. A screenshot of Expo Go's error.

If the app loads but shows a blank white screen or endless spinner, suspect
the font gate (rn-ui-pitfalls.md) or a JS error — shake → Reload shows it.

## 6. Timeline of what went wrong

1. `expo start --tunnel` with the headless flag → "no QR is shown" (non-
   interactive mode prints none; ngrok also couldn't be installed without a
   prompt). Misdiagnosed at the time as ngrok stalling.
2. Switched to GitHub's forwarded port → worked for a session.
3. After a Codespace restart: 404 (port no longer forwarded/public), then
   502 after re-forwarding (stale forward, and the first bundle build
   outlasting the proxy).
4. Added: stale-server cleanup, status-aware advice, keep-public watcher,
   fallback to tunnel, bundle warm-up.
5. User: "always use the tunnel because this is what only works" → tunnel is
   the default; GitHub route opt-in.

Lesson: in a remote setup, pick the route that needs the fewest manual steps
from the user, and make the script prove the address works (from outside,
with the bundle built) before it shows anything to scan.
