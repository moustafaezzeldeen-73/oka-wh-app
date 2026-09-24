# Expo SDK, config, secrets and device features

## Upgrading the SDK for Expo Go
Exact working versions, copy-ready config files, the 54 → 57 upgrade steps
and every breakage met are in [expo-go-sdk-build.md](expo-go-sdk-build.md).
The short version: Expo Go only runs the latest SDK; when `npx expo install`
can't reach `api.expo.dev`, take versions from
`node_modules/expo/bundledNativeModules.json`; verify with `tsc`,
`expo-doctor` and `expo export --platform all` (then delete the output — it
embeds secrets).

## Config and `.env`
- `app.config.js` reads `process.env` and passes values through `extra`;
  the app reads them with `expo-constants`. Everything in `extra` is in the
  bundle **and** in the dev-server manifest — anyone with the dev URL (a
  public tunnel or port) can read it. Keep the server stopped when not
  testing; use a proxy for rollout.
- Expo's `.env` parser drops everything after an unquoted `#`:
  `PASS=abc#def` → `abc`. Quote such values, and make any check script parse
  `.env` with `node:util` `parseEnv` (same rules) and flag unquoted `#`.
- Keep `.env` git-ignored; ship `.env.example` documenting every key, where
  to get it, and required scopes.

## Device features in Expo Go
- **Camera / barcode scanning:** `expo-camera` `CameraView` with
  `barcodeScannerSettings.barcodeTypes` including `code128` (letter+digit
  AWBs) and `qr`. Use a cooldown after each scan and haptics for
  accept/refuse.
- **Call recording:** ordinary apps can't record phone calls (Android 10+
  gives silence; iOS interrupts the audio session). Use the phone's own
  recorder: on Android builds, find the new file via expo-media-library
  (`Query` on `AUDIO`, created since the call started, filename containing
  the number wins); in Expo Go on Android media-library audio access isn't
  grantable and iOS has none, so fall back to `expo-document-picker`
  (`audio/*`). On iPhone, recordings live in Notes → share to Files first.
- **Transcription:** Gemini `generateContent` with inline base64 audio
  (keep raw audio under ~14 MB; AMR/3GP unsupported), a `responseSchema` for
  `{summary, transcript}`, and split speaker turns on labels because the
  model runs them together.
- **Files on device:** expo-file-system's `File` class (`.base64()`,
  `.size`, `Paths.cache`) for reading recordings and writing temp text.

## Tests that catch real drift
- Keep pure logic (mapping, signing, parsing) free of native imports so a
  Node test build can run it; exclude `scripts/` from the app `tsconfig` if
  tests import `node:crypto`.
- Fixtures copied from live responses (structure verbatim, personal data
  replaced) catch schema drift; add a regression test for every live surprise
  (numeric error codes, no-results-as-error, Cairo times, run-together
  transcript turns).
