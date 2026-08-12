import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Barcode } from '../components/Barcode';
import { PrimaryButton, Txt } from '../components/primitives';
import { useApp } from '../state/AppState';
import { C, GUTTER, R } from '../theme/tokens';

/**
 * Live barcode scanner. Reads the AWB (Code 128 on Bosta labels) or a QR, then
 * resolves it against Bosta + Shopify and opens the order.
 */
export function ScanScreen() {
  const { L, go, handleScan, select, showToast } = useApp();
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(false);
  const lastCode = useRef<string>('');
  const cooling = useRef(false);

  const onCode = useCallback(
    async (code: string) => {
      // A camera emits the same barcode many times a second; debounce it.
      if (cooling.current || busy) return;
      if (code === lastCode.current) return;
      cooling.current = true;
      lastCode.current = code;
      setBusy(true);
      setFlash(true);

      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      try {
        const order = await handleScan(code);
        if (order) {
          select(order.shopifyId);
          go('detail');
        }
      } finally {
        setFlash(false);
        setBusy(false);
        setTimeout(() => {
          cooling.current = false;
          lastCode.current = '';
        }, 1500);
      }
    },
    [busy, go, handleScan, select],
  );

  const granted = permission?.granted ?? false;

  return (
    <View style={{ flex: 1, backgroundColor: C.dark, minHeight: 0 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingTop: 6,
          paddingHorizontal: GUTTER,
        }}
      >
        <Pressable onPress={() => go('list')} style={{ paddingVertical: 8 }}>
          <Txt f="sansSemi" size={14} color={C.onDark70}>
            ✕ {L.close}
          </Txt>
        </Pressable>
        <Txt f="sansSemi" size={14} color={C.white}>
          {L.scan}
        </Txt>
      </View>

      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        {granted ? (
          <CameraView
            style={{ position: 'absolute', inset: 0 }}
            facing="back"
            barcodeScannerSettings={{
              barcodeTypes: ['code128', 'code39', 'ean13', 'ean8', 'qr', 'upc_a', 'itf14'],
            }}
            onBarcodeScanned={({ data }) => void onCode(data)}
          />
        ) : null}

        {/* Reticle */}
        <View
          style={{
            width: 250,
            height: 170,
            borderRadius: R.panel,
            borderWidth: 2,
            borderStyle: 'dashed',
            borderColor: C.onDark35,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: flash ? 'rgba(47,191,119,0.5)' : 'transparent',
          }}
        >
          {!granted ? <Barcode value={null} height={60} color={C.onDark55} /> : null}
          {busy ? <ActivityIndicator size="large" color={C.white} /> : null}
          <View
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              height: 2,
              backgroundColor: C.scanLine,
              shadowColor: C.scanLine,
              shadowOpacity: 1,
              shadowRadius: 14,
              elevation: 6,
            }}
          />
        </View>
      </View>

      <View style={{ paddingHorizontal: GUTTER, paddingBottom: 26, alignItems: 'center' }}>
        <Txt size={14} color={C.onDark50} align="center" style={{ marginBottom: 16 }}>
          {granted ? L.scanHint : L.cameraPermission}
        </Txt>
        {granted ? (
          <View style={{ alignSelf: 'stretch', height: 64 }} />
        ) : (
          <PrimaryButton
            label={L.grantPermission}
            onPress={() => {
              void requestPermission().then((r) => {
                if (!r.granted) showToast(L.cameraPermission);
              });
            }}
            color={C.white}
            textColor={C.ink}
            height={64}
            style={{ alignSelf: 'stretch' }}
          />
        )}
      </View>
    </View>
  );
}
