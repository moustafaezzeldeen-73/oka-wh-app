import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useAudioPlayer } from 'expo-audio';
import React, { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Barcode } from '../components/Barcode';
import { CheckSmallIcon } from '../components/Icons';
import { Mono, Txt } from '../components/primitives';
import { logActivity } from '../api/activity';
import { useApp } from '../state/AppState';
import { C, GUTTER, R } from '../theme/tokens';

/**
 * Burst scan for truck loading: the camera stays live, each accepted AWB
 * increments the counter, beeps, and is logged onto its Shopify order.
 */
export function PickupScreen() {
  const { L, go, scanned, pushScanned, undoScan, beep, toggleBeep, handleScan, orders, showToast } =
    useApp();
  const [permission, requestPermission] = useCameraPermissions();
  const [flash, setFlash] = useState(false);
  const cooling = useRef(false);

  // A short click on every accepted scan, so the picker never looks at the screen.
  const player = useAudioPlayer(require('../../assets/beep.wav'));

  const onCode = useCallback(
    async (code: string) => {
      if (cooling.current) return;
      cooling.current = true;
      setTimeout(() => {
        cooling.current = false;
      }, 1200);

      const order = await handleScan(code);
      if (!order) return;

      if (scanned.includes(order.shopifyId)) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        showToast(L.scannedAlready);
        return;
      }

      setFlash(true);
      setTimeout(() => setFlash(false), 200);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (beep) {
        try {
          player.seekTo(0);
          player.play();
        } catch {
          // A silent beep is not worth interrupting the scan run.
        }
      }

      pushScanned(order.shopifyId);

      // Log the load event onto the Shopify order without blocking the next scan.
      void logActivity(order.shopifyId, 'scan', 'Loaded on the truck (pickup scan)', {
        meta: { awb: order.awb },
      }).catch(() => undefined);
    },
    [L, beep, handleScan, player, pushScanned, scanned, showToast],
  );

  const rows = scanned
    .slice()
    .reverse()
    .map((id) => orders.find((o) => o.shopifyId === id))
    .filter((o): o is NonNullable<typeof o> => Boolean(o));

  const granted = permission?.granted ?? false;

  return (
    <View
      style={{
        flex: 1,
        minHeight: 0,
        backgroundColor: flash ? C.greenFlash : C.greenDeep,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingTop: 6,
          paddingHorizontal: GUTTER,
        }}
      >
        <Pressable onPress={() => go('modes')} style={{ paddingVertical: 8 }}>
          <Txt f="sansSemi" size={14} color={C.onDark75}>
            ✕ {L.exit}
          </Txt>
        </Pressable>
        <Pressable
          onPress={toggleBeep}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 }}
        >
          <Txt f="sansSemi" size={13} color={C.onDark75}>
            {L.beep}
          </Txt>
          <View
            style={{
              width: 42,
              height: 26,
              borderRadius: 13,
              padding: 3,
              backgroundColor: beep ? 'rgba(255,255,255,0.9)' : C.onDark25,
              flexDirection: 'row',
              justifyContent: beep ? 'flex-end' : 'flex-start',
            }}
          >
            <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: C.white }} />
          </View>
        </Pressable>
      </View>

      <View style={{ paddingTop: 26, paddingHorizontal: GUTTER, paddingBottom: 22, alignItems: 'center' }}>
        <Txt f="sansSemi" size={13} color={C.onDark70} ls={1.04}>
          {L.pickup}
        </Txt>
        <Mono size={108} lh={108} ls={-6} color={C.white} style={{ marginTop: 6, marginBottom: 4 }}>
          {scanned.length}
        </Mono>
        <Txt size={14} color={C.onDark70}>
          {L.loaded}
        </Txt>

        <Pressable
          onPress={granted ? undefined : () => void requestPermission()}
          style={{
            marginTop: 20,
            height: 70,
            alignSelf: 'stretch',
            borderRadius: 20,
            borderWidth: 2,
            borderStyle: 'dashed',
            borderColor: C.onDark35,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            overflow: 'hidden',
          }}
        >
          {granted ? (
            <CameraView
              style={{ position: 'absolute', inset: 0, opacity: 0.35 }}
              facing="back"
              barcodeScannerSettings={{
                barcodeTypes: ['code128', 'code39', 'ean13', 'qr', 'itf14'],
              }}
              onBarcodeScanned={({ data }) => void onCode(data)}
            />
          ) : null}
          <Barcode value={null} height={34} color={C.onDark60} />
          <Txt f="sansSemi" size={15} color={C.white}>
            {granted ? L.tapScan : L.grantPermission}
          </Txt>
        </Pressable>
      </View>

      <ScrollView
        style={{
          flex: 1,
          backgroundColor: C.white,
          borderTopLeftRadius: R.sheet,
          borderTopRightRadius: R.sheet,
        }}
        contentContainerStyle={{ padding: 16, paddingHorizontal: GUTTER, paddingBottom: 100, gap: 8 }}
      >
        {rows.map((o, i) => (
          <View
            key={o.shopifyId}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              paddingVertical: 11,
              paddingHorizontal: 13,
              borderRadius: R.card,
              backgroundColor: i === 0 ? '#E8F3EC' : C.bg,
            }}
          >
            <View
              style={{
                width: 30,
                height: 30,
                borderRadius: R.pill,
                backgroundColor: C.greenDeep,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <CheckSmallIcon />
            </View>
            <Mono size={18} style={{ flex: 1 }}>
              {o.awb ?? o.name}
            </Mono>
            <Txt size={13} color={C.ink45}>
              {o.city}
            </Txt>
          </View>
        ))}
      </ScrollView>

      <View
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          paddingTop: 12,
          paddingHorizontal: GUTTER,
          paddingBottom: 22,
          backgroundColor: C.white,
          flexDirection: 'row',
          gap: 10,
        }}
      >
        <Pressable
          onPress={undoScan}
          style={{
            width: 78,
            height: 58,
            borderRadius: 17,
            backgroundColor: C.surfaceMuted,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Txt f="sansSemi" size={14}>
            {L.undo}
          </Txt>
        </Pressable>
        <Pressable
          onPress={() => go('modes')}
          style={{
            flex: 1,
            height: 58,
            borderRadius: 17,
            backgroundColor: C.ink,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Txt f="sansMedium" size={17} color={C.white}>
            {L.finish}
          </Txt>
        </Pressable>
      </View>
    </View>
  );
}
