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
- **expo-media-library's `Query` can't find audio by `CREATION_TIME`.** It
  maps that field to MediaStore's `DATE_TAKEN`, which Android fills only for
  photos and videos, so `.gte(AssetField.CREATION_TIME, …)` returns no audio
  at all, and `getCreationTime()` is null. Filter and sort on
  `AssetField.MODIFICATION_TIME` instead: it is `DATE_MODIFIED`, converted
  ms ⇄ s by the module, and for a call recording it is the hang-up time.
  `getDuration()` is video-only too. Expo Go never runs this path, so
  nothing showed the bug until a real APK was planned. Read the native
  module's column mapping before trusting a field on a media type it wasn't
  written for.
- **Huawei EMUI 5 (Android 7.0, e.g. nova plus MLA-L11):**
  - Record from the call screen, or Phone → ⋮ → Settings → Auto-record
    calls.
  - Files are `record/<contact>@<number>_<yyyyMMddHHmmss>.amr`, so they
    match on the number. EMUI 10+ moved to `Sounds/CallRecord/*.m4a`.
  - On Android < 13, expo-media-library asks for `READ_EXTERNAL_STORAGE`,
    and asks for `WRITE_EXTERNAL_STORAGE` only if the manifest still has
    it, so blocking WRITE is safe.
  - The `MODIFICATION_TIME` query works the same on the pre-Android-10 code
    path.
- **Samsung (One UI 7/8, e.g. Galaxy A17):**
  - The Phone app records calls itself: ⋮ → Settings → Record calls → Auto
    record calls. The option is missing where the regional firmware forbids
    recording.
  - Files are `Recordings/Call/Call recording <number|contact>_<yymmdd>_<hhmmss>.m4a`.
    Match on the number's last 9 digits, then on a call-like name (so a
    WhatsApp `PTT-….opus` voice note that arrived mid-call loses), then on
    timing.
  - Android 13+ needs `READ_MEDIA_AUDIO` (expo-media-library
    `granularPermissions: ['audio']`). The file URI is `file://`, readable
    for upload and base64.
- **Transcription:** Gemini `generateContent` with inline base64 audio
  (keep raw audio under ~14 MB). Live tests transcribed formats that aren't
  on Google's documented list: `.m4a` as `audio/mp4`, **AMR** narrow- and
  wide-band as `audio/amr`, and 3GP as `audio/3gpp`. I had excluded AMR from
  the docs alone, which would have left every Huawei EMUI ≤ 9 recording
  untranscribed. Test formats with a real request, e.g. ffmpeg from the
  `imageio-ffmpeg` wheel plus speech from the `mespeak` npm package when no
  sample can be downloaded. Use a `responseSchema` for
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
