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
  assetBundlePatterns: ['**/*'],
  android: {
    package: 'com.okaegypt.warehouse',
    adaptiveIcon: { backgroundColor: '#0F9D58' },
    permissions: ['CAMERA', 'INTERNET', 'VIBRATE'],
    // The media library plugin always asks for these; the app only reads the
    // phone's own call recordings (READ_MEDIA_AUDIO) and never records audio.
    blockedPermissions: [
      'android.permission.RECORD_AUDIO',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.READ_MEDIA_IMAGES',
      'android.permission.READ_MEDIA_VIDEO',
      'android.permission.READ_MEDIA_VISUAL_USER_SELECTED',
    ],
  },
  ios: {
    // Only matters for a real build (`eas build`) — Expo Go ignores this and
    // uses its own Info.plist.
    bundleIdentifier: 'com.okaegypt.warehouse',
    infoPlist: {
      NSCameraUsageDescription:
        'OKA Warehouse uses the camera to scan AWB barcodes and photograph order contents.',
    },
  },
  plugins: [
    [
      'expo-camera',
      {
        cameraPermission:
          'OKA Warehouse uses the camera to scan AWB barcodes and photograph order contents.',
        microphonePermission: false,
        recordAudioAndroid: false,
      },
    ],
    [
      // Only the scan beep; nothing is recorded in-app.
      'expo-audio',
      {
        microphonePermission: false,
        recordAudioAndroid: false,
        enableBackgroundRecording: false,
        enableBackgroundPlayback: false,
      },
    ],
    [
      // Reads the phone's own call recordings after a call (Android build only).
      'expo-media-library',
      {
        granularPermissions: ['audio'],
        photosPermission: false,
        savePhotosPermission: false,
      },
    ],
  ],
  extra: {
    shopifyStoreDomain: process.env.SHOPIFY_STORE_DOMAIN || '',
    shopifyAdminToken: process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '',
    // With a permanent token the app never needs the Client secret, so it is
    // left out of the bundle entirely.
    shopifyClientId: process.env.SHOPIFY_ADMIN_ACCESS_TOKEN ? '' : process.env.SHOPIFY_CLIENT_ID || '',
    shopifyClientSecret: process.env.SHOPIFY_ADMIN_ACCESS_TOKEN
      ? ''
      : process.env.SHOPIFY_CLIENT_SECRET || '',
    shopifyApiVersion: process.env.SHOPIFY_API_VERSION || '2026-07',
    bostaApiKey: process.env.BOSTA_API_KEY || '',
    bostaBaseUrl: process.env.BOSTA_BASE_URL || 'https://app.bosta.co/api/v2',
    jtApiAccount: process.env.JT_API_ACCOUNT || '',
    jtPrivateKey: process.env.JT_PRIVATE_KEY || '',
    jtCustomerCode: process.env.JT_CUSTOMER_CODE || '',
    jtCustomerPassword: process.env.JT_CUSTOMER_PASSWORD || '',
    jtBaseUrl: process.env.JT_API_BASE_URL || 'https://openapi.jtjms-eg.com/webopenplatformapi',
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    geminiModel: process.env.GEMINI_AUDIO_MODEL || 'gemini-2.5-flash',
    // Optional: route all API traffic through your own backend instead of
    // calling Shopify/Bosta straight from the device. When set, the clients
    // POST to `${apiProxyUrl}/shopify` and `${apiProxyUrl}/bosta` and no
    // credentials are bundled into the app.
    apiProxyUrl: process.env.API_PROXY_URL || '',
  },
});
