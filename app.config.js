/**
 * Expo app config.
 *
 * Runs in Node at bundle time, so it can read every key in `.env` — not just the
 * `EXPO_PUBLIC_*` ones the bundler injects. Credentials are forwarded to the app
 * through `extra`, and read at runtime via `expo-constants` (see src/api/config.ts).
 */
module.exports = ({ config }) => ({
  ...config,
  name: 'OKA Warehouse',
  slug: 'oka-wh-app',
  version: '1.0.0',
  orientation: 'portrait',
  scheme: 'okawh',
  userInterfaceStyle: 'light',
  newArchEnabled: true,
  assetBundlePatterns: ['**/*'],
  android: {
    package: 'com.okaegypt.warehouse',
    adaptiveIcon: { backgroundColor: '#0F9D58' },
    permissions: [
      'CAMERA',
      'RECORD_AUDIO',
      'MODIFY_AUDIO_SETTINGS',
      'READ_PHONE_STATE',
      'CALL_PHONE',
      'INTERNET',
      'VIBRATE',
      'FOREGROUND_SERVICE',
      'FOREGROUND_SERVICE_MICROPHONE',
    ],
  },
  ios: {
    // Only matters for a real build (`eas build`) — Expo Go ignores this and
    // uses its own Info.plist, which already declares camera/mic usage for
    // the modules it ships (that's why permission prompts still work when
    // testing under Expo Go with no ios config at all).
    bundleIdentifier: 'com.okaegypt.warehouse',
    infoPlist: {
      NSCameraUsageDescription:
        'OKA Warehouse uses the camera to scan AWB barcodes and photograph order contents.',
      NSMicrophoneUsageDescription:
        'OKA Warehouse records customer calls so they can be attached to the order.',
      UIBackgroundModes: ['audio'],
    },
  },
  plugins: [
    [
      'expo-camera',
      {
        cameraPermission:
          'OKA Warehouse uses the camera to scan AWB barcodes and photograph order contents.',
        microphonePermission:
          'OKA Warehouse records customer calls so they can be attached to the order.',
        recordAudioAndroid: true,
      },
    ],
    [
      'expo-audio',
      {
        microphonePermission:
          'OKA Warehouse records customer calls so they can be attached to the order.',
      },
    ],
  ],
  extra: {
    shopifyStoreDomain: process.env.SHOPIFY_STORE_DOMAIN || '',
    shopifyAdminToken: process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '',
    shopifyApiVersion: process.env.SHOPIFY_API_VERSION || '2026-07',
    bostaApiKey: process.env.BOSTA_API_KEY || '',
    bostaBaseUrl: process.env.BOSTA_BASE_URL || 'https://app.bosta.co/api/v2',
    // Optional: route all API traffic through your own backend instead of
    // calling Shopify/Bosta straight from the device. When set, the clients
    // POST to `${apiProxyUrl}/shopify` and `${apiProxyUrl}/bosta` and no
    // credentials are bundled into the app.
    apiProxyUrl: process.env.API_PROXY_URL || '',
  },
});
