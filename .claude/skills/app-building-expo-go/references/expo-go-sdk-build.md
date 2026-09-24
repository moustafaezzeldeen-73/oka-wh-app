# The Expo Go SDK build — a known-good setup (SDK 57)

This is the exact dependency set, config and checks the OKA Warehouse app ran
on in Expo Go (iPhone, App Store build) in September 2026. Use it to start a
new Expo Go app, or as the target when upgrading an older one.

## Contents
1. Which SDK Expo Go runs, and how to check
2. Known-good versions
3. Files to copy (package.json, app.config.js, tsconfig, index.js)
4. Upgrading an older project (54 → 57, what broke)
5. Verifying the build before touching a phone
6. When Expo Go isn't enough

## 1. Which SDK Expo Go runs, and how to check

- The store build of **Expo Go supports exactly one SDK — the latest**
  (57 at the time of writing). A project on any other SDK won't open
  ("Project is incompatible with this version of Expo Go"). Upgrade the
  project; don't hunt for old Expo Go builds.
- Before a phone is involved, confirm the project's SDK:
  - `node -e "console.log(require('expo/package.json').version)"` → `57.0.x`
  - or ask the running dev server for the manifest and read `sdkVersion`:
    ```bash
    curl -s -H 'expo-platform: ios' -H 'accept: application/expo+json' \
      http://127.0.0.1:8081/ | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.runtimeVersion, j.extra.expoClient.sdkVersion)})'
    # → exposdk:57.0.0 57.0.0
    ```
    (Don't print the whole manifest: it contains everything in `extra`,
    including keys.)
- On the phone, Expo Go → Settings shows the SDK version(s) it supports.

## 2. Known-good versions

| Package | Version | Notes |
| --- | --- | --- |
| expo | ~57.0.24 | Expo CLI 57.0.26 underneath (`expo/node_modules/@expo/cli`) |
| react-native | 0.86.3 | New Architecture only (the switch is gone since SDK 55) |
| react | 19.2.3 | |
| Hermes | bundled (`hermes-compiler` 250829098.0.17) | Bundles export as `.hbc`, ~2.1 MB per platform for this app |
| typescript | ~6.0.3 | `baseUrl` and `moduleResolution: node10` deprecated |
| @types/react | ~19.2.2 | |
| Node | 22.x | Needs ≥ 20.12 (`node:util` `parseEnv`, `@expo/env`) |
| expo-asset | ~57.0.18 | Must be a direct dependency (expo-audio peer) |
| expo-audio | ~57.0.5 | |
| expo-camera | ~57.0.5 | `CameraView` + barcode scanning |
| expo-clipboard | ~57.0.2 | |
| expo-constants | ~57.0.19 | Reads `extra` from app.config.js |
| expo-document-picker | ~57.0.2 | |
| expo-file-system | ~57.0.7 | New `File` / `Paths` API |
| expo-font | ~57.0.4 | |
| expo-haptics | ~57.0.3 | |
| expo-image | ~57.0.5 | |
| expo-keep-awake | ~57.0.2 | |
| expo-linking | ~57.0.10 | |
| expo-media-library | ~57.0.5 | New `Query` / `AssetField` API |
| expo-status-bar | ~57.0.1 | |
| react-native-safe-area-context | ~5.7.0 | |
| react-native-svg | 15.15.4 | |
| @expo/ngrok (dev) | ^4.1.3 | So `--tunnel` never has to prompt |
| @expo-google-fonts/* | ^0.4.x | Import per-weight `.ttf` subpaths |

The authoritative list for any SDK is
`node_modules/expo/bundledNativeModules.json` once the right `expo` is
installed — use it when `npx expo install` can't reach `api.expo.dev`.

## 3. Files to copy

**package.json** (dependencies trimmed to what an Expo Go app like this needs):
```json
{
  "main": "index.js",
  "private": true,
  "scripts": {
    "start": "expo start",
    "start:codespace": "node scripts/start-codespace.mjs",
    "typecheck": "tsc --noEmit",
    "bundle": "expo export --platform all --output-dir dist"
  },
  "dependencies": {
    "expo": "~57.0.24",
    "expo-asset": "~57.0.18",
    "expo-constants": "~57.0.19",
    "expo-font": "~57.0.4",
    "expo-status-bar": "~57.0.1",
    "react": "^19.2.3",
    "react-native": "^0.86.3",
    "react-native-safe-area-context": "~5.7.0"
  },
  "devDependencies": {
    "@expo/ngrok": "^4.1.3",
    "@types/react": "~19.2.2",
    "typescript": "~6.0.3"
  }
}
```
Add other `expo-*` modules at the versions in section 2.

**index.js** — no `babel.config.js` or `metro.config.js` is needed on SDK 57:
```js
import { registerRootComponent } from 'expo';
import App from './App';
registerRootComponent(App);
```

**app.config.js** — dynamic config so every `.env` key is available (not only
`EXPO_PUBLIC_*`); values reach the app through `extra` → `expo-constants`:
```js
module.exports = ({ config }) => ({
  ...config,
  name: 'My App',
  slug: 'my-app',
  version: '1.0.0',
  orientation: 'portrait',
  scheme: 'myapp',
  userInterfaceStyle: 'light',
  assetBundlePatterns: ['**/*'],
  android: { package: 'com.example.myapp', permissions: ['CAMERA', 'INTERNET', 'VIBRATE'] },
  ios: {
    // Only used by real builds; Expo Go uses its own Info.plist.
    bundleIdentifier: 'com.example.myapp',
    infoPlist: { NSCameraUsageDescription: 'Scans barcodes and photographs parcels.' },
  },
  plugins: [
    // Turn off every permission the app doesn't use, per plugin.
    ['expo-camera', { cameraPermission: 'Scans barcodes.', microphonePermission: false, recordAudioAndroid: false }],
  ],
  extra: {
    apiBaseUrl: process.env.API_BASE_URL || '',
    // Everything here ships in the bundle and the dev manifest — see SKILL.md.
  },
});
```
Don't add `newArchEnabled` (removed from the schema).

**tsconfig.json**:
```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": { "strict": true, "jsx": "react-jsx" },
  "include": ["**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules", "scripts"]
}
```
No `baseUrl` / `paths` (TS 6). `scripts` is excluded so Node-only test code
(`node:crypto`, etc.) doesn't fail the app typecheck.

**tsconfig.test.json** — a Node build of the pure logic for fast tests:
```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "node16", "moduleResolution": "node16",
    "strict": true, "esModuleInterop": true, "skipLibCheck": true,
    "outDir": ".test-build", "types": ["node"]
  },
  "include": ["scripts/test-logic.ts", "src/api/model.ts", "src/api/*State.ts"]
}
```

## 4. Upgrading an older project (54 → 57, what broke)

The upgrade that made the app open in Expo Go again moved Expo 54 → 57.0.24,
React Native 0.81 → 0.86.3, React 19.1 → 19.2.3, TypeScript 5.9 → 6.0, and
every Expo module to its SDK 57 release.

Steps:
1. `npm install expo@~57.0.24` (or `npx expo install expo@^57` where the
   network allows).
2. Align every Expo module: `npx expo install --fix`, or — when
   `api.expo.dev` is blocked — copy versions from
   `node_modules/expo/bundledNativeModules.json` into package.json and
   `npm install`.
3. Fix the breakages below, then run the checks in section 5.

Breakages met:
- **expo-audio** — background recording became its own audio-mode flag,
  `allowsBackgroundRecording` (setting the playback flag let recording stop
  when the dialer opened); the plugin's `enableBackgroundRecording` registers
  the microphone foreground service Android 14+ requires.
- **expo-asset** must be installed directly (expo-doctor flags it).
- **`newArchEnabled`** removed from the config schema.
- **TypeScript 6** — remove `baseUrl` (and the `@/` alias it served); switch
  Node-side builds from `node10` to `node16` module resolution.
- **Unused packages** — dropping ones nothing imported (e.g. `react-dom`)
  shrank each bundle from 2.25 MB to 1.9 MB.

## 5. Verifying the build before touching a phone

```bash
npx tsc --noEmit                                   # app typecheck
npm test                                           # logic tests on live payload shapes
npx expo-doctor                                    # dependency/config checks
EXPO_OFFLINE=1 npx expo export --platform all --output-dir /tmp/out && rm -rf /tmp/out
```
- `expo-doctor` checks that need `api.expo.dev` fail in sandboxed networks —
  judge the rest.
- A successful export proves Metro can resolve and compile the whole app for
  both platforms (look for the `.hbc` lines). Delete the output: it embeds
  every key from `extra`.
- Then start with the tunnel (`npm run start:codespace`), wait for the
  bundles to be built, and scan.

## 6. When Expo Go isn't enough

Expo Go ships a fixed set of native modules and permissions. Features that
need their own (e.g. reading the phone's call recordings with
`READ_MEDIA_AUDIO` on Android, custom native code) need a **development
build** (`expo-dev-client` + EAS Build). In this project those paths were
written with an Expo Go fallback (file picker) and the dev build was left for
later — design features so Expo Go degrades gracefully rather than failing.
