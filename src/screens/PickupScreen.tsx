import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useAudioPlayer } from 'expo-audio';
import React, { useCallback, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, TextInput, View } from 'react-native';

import { Barcode } from '../components/Barcode';
import { CheckSmallIcon } from '../components/Icons';
import { Mono, Txt } from '../components/primitives';
import { CARRIER_NAME, type CarrierKey } from '../api/model';
import { useApp } from '../state/AppState';
import { C, F, GUTTER, R } from '../theme/tokens';

const TRUCKS: CarrierKey[] = ['jt', 'bosta', 'inhouse'];

/**
 * Burst scan for truck loading: pick the truck (J&T pickup, Bosta pickup or
 * OKA's own in-house run), then the camera stays live and each accepted parcel
 * increments the counter, beeps, and is logged onto its Shopify order. A parcel
 * booked with another courier is refused with a red flash. In-house loading
 * also tags the order as out for delivery.
 */
export function PickupScreen() {
  const {
    L,
    go,
    scanned,
    pushScanned,
    undoScan,
    resetScans,
    beep,
    toggleBeep,
    handleScan,
    orders,
    showToast,
    truckCarrier,
    setTruckCarrier,
    loadOnTruck,
  } = useApp();
  const [permission, requestPermission] = useCameraPermissions();
  const [flash, setFlash] = useState(false);
  const [refused, setRefused] = useState(false);
  const [manual, setManual] = useState('');
  const cooling = useRef(false);

  const truckLabel = (c: CarrierKey) => (c === 'inhouse' ? L.inhouse : CARRIER_NAME[c]);
  // Blue for OKA's own delivery run, green for courier pickups.
  const inhouse = truckCarrier === 'inhouse';
  const accent = inhouse ? C.blue : C.greenDeep;

  const chooseTruck = (c: CarrierKey) => {
    if (c === truckCarrier) return;
    if (scanned.length === 0) {
      setTruckCarrier(c);
      return;
    }
    Alert.alert(L.newTruck, L.newTruckBody.replace('{n}', String(scanned.length)), [
      { text: L.no, style: 'cancel' },
      {
        text: L.yes,
        onPress: () => {
          resetScans();
          setTruckCarrier(c);
        },
      },
    ]);
  };

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

      const loaded = await loadOnTruck(order);
      if (!loaded.ok) {
        setRefused(true);
        setTimeout(() => setRefused(false), 600);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        showToast(loaded.reason);
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
    },
    [L, beep, handleScan, loadOnTruck, player, pushScanned, scanned, showToast],
  );

  const addManual = () => {
    const digits = manual.replace(/\D/g, '');
    if (!digits) return;
    setManual('');
    cooling.current = false;
    void onCode(`#${digits}`);
  };

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
        backgroundColor: flash ? (inhouse ? C.blueFlash : C.greenFlash) : refused ? C.red : accent,
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

      {/* ── which truck ── */}
      <View style={{ paddingTop: 10, paddingHorizontal: GUTTER }}>
        <Txt f="sansSemi" size={12} color={C.onDark70} style={{ marginBottom: 6 }}>
          {L.truckCourier}
        </Txt>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {TRUCKS.map((c) => {
            const on = c === truckCarrier;
            return (
              <Pressable
                key={c}
                onPress={() => chooseTruck(c)}
                style={{
                  flex: 1,
                  height: 40,
                  borderRadius: R.pill,
                  backgroundColor: on ? C.white : C.onDark12,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Txt f="sansSemi" size={14} color={on ? accent : C.white}>
                  {truckLabel(c)}
                </Txt>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={{ paddingTop: 18, paddingHorizontal: GUTTER, paddingBottom: 16, alignItems: 'center' }}>
        <Txt f="sansSemi" size={13} color={C.onDark70} ls={1.04}>
          {L.pickup} · {truckLabel(truckCarrier)}
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

        {/* For parcels without a label — in-house orders often have none. */}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, alignSelf: 'stretch' }}>
          <TextInput
            value={manual}
            onChangeText={setManual}
            onSubmitEditing={addManual}
            keyboardType="number-pad"
            returnKeyType="done"
            placeholder={L.orderNumber}
            placeholderTextColor={C.onDark50}
            style={{
              flex: 1,
              height: 44,
              borderRadius: R.card,
              backgroundColor: C.onDark12,
              paddingHorizontal: 14,
              fontFamily: F.monoMedium,
              fontSize: 16,
              color: C.white,
              textAlign: 'left',
            }}
          />
          <Pressable
            onPress={addManual}
            style={{
              height: 44,
              paddingHorizontal: 18,
              borderRadius: R.card,
              backgroundColor: C.white,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Txt f="sansSemi" size={14} color={accent}>
              {L.add}
            </Txt>
          </Pressable>
        </View>
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
              backgroundColor: i === 0 ? (inhouse ? C.blueTint : '#E8F3EC') : C.bg,
            }}
          >
            <View
              style={{
                width: 30,
                height: 30,
                borderRadius: R.pill,
                backgroundColor: accent,
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
