import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';

import { PrimaryButton, Txt } from '../components/primitives';
import type { Order } from '../api/model';
import { useApp } from '../state/AppState';
import { usePhotos } from '../state/usePhotos';
import { C, R } from '../theme/tokens';

type Shot = { uri: string; status: 'uploading' | 'saved' | 'failed'; error?: string };

/**
 * Camera for photographing order contents. Each shot uploads to Shopify Files,
 * joins the order's Warehouse photos field (thumbnails on the Shopify order
 * page) and is logged on the order, so packing disputes have evidence attached
 * to the order record itself. A shot only counts as saved once Shopify has it;
 * a failed one says why and can be retried.
 */
export function PhotoSheet({ order }: { order: Order }) {
  const { L, openSheet, attachPhoto } = useApp();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [busy, setBusy] = useState(false);

  const saved = usePhotos(order);
  const failed = shots.filter((s) => s.status === 'failed');

  const upload = useCallback(
    async (uri: string) => {
      setBusy(true);
      setShots((all) => all.map((s) => (s.uri === uri ? { uri, status: 'uploading' } : s)));
      try {
        const res = await attachPhoto(order, uri);
        setShots((all) =>
          all.map((s) =>
            s.uri !== uri ? s : res.ok ? { uri, status: 'saved' } : { uri, status: 'failed', error: res.error },
          ),
        );
      } finally {
        setBusy(false);
      }
    },
    [attachPhoto, order],
  );

  const capture = useCallback(async () => {
    if (!camera.current || busy) return;
    setBusy(true);
    let uri: string | undefined;
    try {
      uri = (await camera.current.takePictureAsync({ quality: 0.7, skipProcessing: true }))?.uri;
    } finally {
      setBusy(false);
    }
    if (!uri) return;
    setShots((all) => [...all, { uri: uri as string, status: 'uploading' }]);
    await upload(uri);
  }, [busy, upload]);

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

      {failed.length > 0 ? (
        <View style={{ paddingTop: 12, paddingHorizontal: 20 }}>
          <Txt f="sansSemi" size={13} color={C.recordText}>
            {L.photoFailed} · {L.tapToRetry}
          </Txt>
          <Txt size={12} color={C.onDark70} style={{ marginTop: 3 }} numberOfLines={3}>
            {failed[failed.length - 1].error}
          </Txt>
        </View>
      ) : null}

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
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxWidth: 150 }}>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {saved.slice(-4).map((p, i) => (
              <View
                key={p.fileId ?? p.url ?? i}
                style={{ width: 46, height: 46, borderRadius: R.tile, backgroundColor: '#2A312F', overflow: 'hidden' }}
              >
                {p.url ? (
                  <Image source={{ uri: p.url }} style={{ width: 46, height: 46 }} contentFit="cover" />
                ) : (
                  <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                    <ActivityIndicator size="small" color={C.onDark50} />
                  </View>
                )}
              </View>
            ))}
            {shots
              .filter((s) => s.status !== 'saved')
              .map((s) => (
                <Pressable
                  key={s.uri}
                  disabled={s.status !== 'failed' || busy}
                  onPress={() => void upload(s.uri)}
                  style={{
                    width: 46,
                    height: 46,
                    borderRadius: R.tile,
                    overflow: 'hidden',
                    borderWidth: s.status === 'failed' ? 2 : 0,
                    borderColor: C.recordDot,
                  }}
                >
                  <Image source={{ uri: s.uri }} style={{ width: 46, height: 46 }} contentFit="cover" />
                  <View
                    style={{
                      position: 'absolute',
                      inset: 0,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: 'rgba(0,0,0,0.45)',
                    }}
                  >
                    {s.status === 'uploading' ? (
                      <ActivityIndicator size="small" color={C.white} />
                    ) : (
                      <Txt f="sansSemi" size={18} color={C.white}>
                        ↻
                      </Txt>
                    )}
                  </View>
                </Pressable>
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
