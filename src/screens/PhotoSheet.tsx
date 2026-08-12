import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';

import { PrimaryButton, Txt } from '../components/primitives';
import type { Order } from '../api/model';
import { useApp } from '../state/AppState';
import { orderPhotos } from '../state/selectors';
import { C, R } from '../theme/tokens';

/**
 * Camera for photographing order contents. Each shot uploads to Shopify Files
 * and is logged on the order, so packing disputes have evidence attached to the
 * order record itself.
 */
export function PhotoSheet({ order }: { order: Order }) {
  const { L, openSheet, attachPhoto } = useApp();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [shots, setShots] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const existing = orderPhotos(order);

  const capture = useCallback(async () => {
    if (!camera.current || busy) return;
    setBusy(true);
    try {
      const photo = await camera.current.takePictureAsync({ quality: 0.7, skipProcessing: true });
      if (photo?.uri) {
        setShots((s) => [...s, photo.uri]);
        await attachPhoto(order, photo.uri);
      }
    } finally {
      setBusy(false);
    }
  }, [attachPhoto, busy, order]);

  const granted = permission?.granted ?? false;

  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: C.darkCamera,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingVertical: 18,
          paddingHorizontal: 20,
        }}
      >
        <Pressable onPress={() => openSheet(null)} hitSlop={8}>
          <Txt f="sansSemi" size={14} color={C.onDark70}>
            ✕ {L.close}
          </Txt>
        </Pressable>
        <Txt f="sansSemi" size={14} color={C.white}>
          {order.awb ?? order.name}
        </Txt>
      </View>

      <View
        style={{
          flex: 1,
          marginHorizontal: 14,
          borderRadius: 20,
          overflow: 'hidden',
          backgroundColor: '#252C2A',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {granted ? (
          <CameraView ref={camera} style={{ position: 'absolute', inset: 0 }} facing="back" />
        ) : (
          <View style={{ alignItems: 'center', gap: 14, padding: 24 }}>
            <Txt f="monoMedium" size={11} color={C.onDark35}>
              CAMERA · ORDER CONTENTS
            </Txt>
            <PrimaryButton
              label={L.grantPermission}
              onPress={() => void requestPermission()}
              color={C.white}
              textColor={C.ink}
              height={48}
            />
          </View>
        )}
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 26,
            bottom: 26,
            left: 26,
            right: 26,
            borderWidth: 1,
            borderColor: C.onDark16,
            borderRadius: 12,
          }}
        />
      </View>

      <View
        style={{
          paddingTop: 18,
          paddingHorizontal: 20,
          paddingBottom: 26,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 14,
        }}
      >
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxWidth: 110 }}>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {[...existing.map((p) => p.url), ...shots].slice(-4).map((uri) => (
              <Image
                key={uri}
                source={{ uri }}
                style={{ width: 46, height: 46, borderRadius: R.tile, backgroundColor: '#2A312F' }}
                contentFit="cover"
              />
            ))}
          </View>
        </ScrollView>

        <View style={{ flex: 1 }} />

        <Pressable
          onPress={() => void capture()}
          disabled={!granted || busy}
          style={{
            width: 70,
            height: 70,
            borderRadius: 35,
            backgroundColor: C.white,
            borderWidth: 5,
            borderColor: C.onDark28,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: granted ? 1 : 0.4,
          }}
        >
          {busy ? <ActivityIndicator color={C.ink} /> : null}
        </Pressable>

        <View style={{ flex: 1 }} />

        <Pressable
          onPress={() => openSheet(null)}
          style={{
            paddingHorizontal: 16,
            height: 46,
            borderRadius: R.card,
            backgroundColor: C.greenDeep,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Txt f="sansSemi" size={13} color={C.white}>
            {L.attach}
          </Txt>
        </Pressable>
      </View>
    </View>
  );
}
