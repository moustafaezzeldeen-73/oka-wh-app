import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import * as Linking from 'expo-linking';
import { useKeepAwake } from 'expo-keep-awake';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import { WhatsAppIcon } from '../components/Icons';
import { Mono, PrimaryButton, Txt } from '../components/primitives';
import type { CallOutcome } from '../api/activity';
import { money, type Order } from '../api/model';
import { useApp } from '../state/AppState';
import { C, R } from '../theme/tokens';

/**
 * Call screen with recording.
 *
 * The app records the microphone from "Start call" to "End call", uploads the
 * file to Shopify Files and links it from the order log, alongside the call's
 * duration and outcome.
 *
 * Neither platform lets an ordinary app record the phone call itself. Android
 * 10+ hands an ordinary app silence while a voice call holds the microphone,
 * and on iOS the cellular call interrupts the app's audio session. So the
 * recording reliably captures what is said before the call connects and after
 * it ends, not the conversation; recording the conversation needs the phone's
 * own call recorder or a dedicated service such as Salestrail.
 * `allowsBackgroundRecording` (plus the plugin's `enableBackgroundRecording`)
 * keeps the recorder alive while the dialer is in front.
 */
export function CallSheet({ order }: { order: Order }) {
  const { L, ar, openSheet, contactTarget, logCall, setContactTarget } = useApp();
  useKeepAwake();

  const isCourier = contactTarget === 'courier' && order.courier !== null;
  const name = isCourier ? (order.courier as { name: string }).name : order.customerName;
  const phone = isCourier ? (order.courier as { phone: string }).phone : order.phone;
  const initials =
    name
      .trim()
      .split(/\s+/)
      .map((w) => w[0] ?? '')
      .slice(0, 2)
      .join('') || '—';

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 500);

  const [phase, setPhase] = useState<'idle' | 'live' | 'outcome'>('idle');
  const [recordingUri, setRecordingUri] = useState<string | null>(null);
  const [micDenied, setMicDenied] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef<number>(0);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (ticker.current) clearInterval(ticker.current);
    },
    [],
  );

  const startCall = useCallback(async () => {
    const perm = await requestRecordingPermissionsAsync();

    if (perm.granted) {
      try {
        await setAudioModeAsync({
          allowsRecording: true,
          // Keeps capture alive once the dialer takes the foreground. This is
          // the recording flag — `shouldPlayInBackground` only covers playback.
          allowsBackgroundRecording: true,
          playsInSilentMode: true,
          interruptionMode: 'doNotMix',
        });
        await recorder.prepareToRecordAsync();
        recorder.record();
        setMicDenied(false);
      } catch {
        // A failed recorder must not stop the call from being placed.
        setMicDenied(true);
      }
    } else {
      setMicDenied(true);
    }

    startedAt.current = Date.now();
    setElapsed(0);
    ticker.current = setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)),
      1000,
    );
    setPhase('live');

    const dial = `tel:${phone}`;
    Linking.openURL(dial).catch(() => undefined);
  }, [phone, recorder]);

  const endCall = useCallback(async () => {
    if (ticker.current) {
      clearInterval(ticker.current);
      ticker.current = null;
    }
    let uri: string | null = null;
    if (state.isRecording) {
      try {
        await recorder.stop();
        uri = recorder.uri ?? null;
      } catch {
        uri = null;
      }
    }
    try {
      await setAudioModeAsync({ allowsRecording: false, allowsBackgroundRecording: false });
    } catch {
      // Restoring the audio mode is best-effort.
    }
    setRecordingUri(uri);
    setPhase('outcome');
  }, [recorder, state.isRecording]);

  const finish = useCallback(
    async (outcome: CallOutcome) => {
      openSheet(null);
      await logCall(order, {
        target: isCourier ? 'courier' : 'customer',
        phone,
        durationSec: elapsed,
        outcome,
        recordingUri,
      });
      setPhase('idle');
      setRecordingUri(null);
      setElapsed(0);
      setContactTarget('customer');
    },
    [elapsed, isCourier, logCall, openSheet, order, phone, recordingUri, setContactTarget],
  );

  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;

  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: C.dark,
        alignItems: 'center',
        paddingTop: 60,
        paddingHorizontal: 24,
        paddingBottom: 34,
      }}
    >
      <View
        style={{
          width: 96,
          height: 96,
          borderRadius: 30,
          backgroundColor: C.onDark10,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Mono size={28} color={C.white}>
          {initials}
        </Mono>
      </View>

      <Txt f="sansSemi" size={24} color={C.white} style={{ marginTop: 18 }} align="center">
        {name}
      </Txt>
      <Mono f="monoMedium" size={16} color={C.onDark55} style={{ marginTop: 6 }}>
        {phone}
      </Mono>

      {phase === 'live' ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            marginTop: 22,
            paddingVertical: 8,
            paddingHorizontal: 14,
            borderRadius: 12,
            backgroundColor: micDenied ? 'rgba(138,101,32,0.25)' : 'rgba(176,42,42,0.18)',
          }}
        >
          <View
            style={{
              width: 9,
              height: 9,
              borderRadius: 5,
              backgroundColor: micDenied ? C.amber : C.recordDot,
            }}
          />
          <Txt f="sansSemi" size={13} color={micDenied ? '#E8C98A' : C.recordText}>
            {micDenied ? L.micPermission : L.recording}
          </Txt>
          <Mono f="monoMedium" size={13} color={C.onDark60}>
            {mmss}
          </Mono>
        </View>
      ) : null}

      {phase === 'live' && !micDenied ? (
        <Txt size={12} lh={18} color={C.onDark50} align="center" style={{ marginTop: 12 }}>
          {L.recordingHint}
        </Txt>
      ) : null}

      {/* order context */}
      <View
        style={{
          marginTop: 26,
          alignSelf: 'stretch',
          backgroundColor: C.onDark06,
          borderRadius: R.panel,
          paddingVertical: 14,
          paddingHorizontal: 16,
        }}
      >
        <Txt f="sansSemi" size={12} color={C.onDark50} style={{ marginBottom: 8 }}>
          {L.awb}
        </Txt>
        <Mono size={20} color={C.white}>
          {order.awb ?? order.name}
        </Mono>
        <Txt size={13} color={C.onDark55} style={{ marginTop: 8 }}>
          {order.itemCount} {L.items} · {money(order.cod)} EGP
        </Txt>
      </View>

      <View style={{ flex: 1 }} />

      {phase === 'idle' ? (
        <View style={{ flexDirection: 'row', gap: 14, alignSelf: 'stretch' }}>
          <PrimaryButton
            label={L.startCall}
            onPress={() => void startCall()}
            color={C.greenDeep}
            height={66}
            style={{ flex: 1 }}
          />
          <Pressable
            onPress={() => openSheet(null)}
            style={{
              width: 66,
              height: 66,
              borderRadius: 20,
              backgroundColor: C.onDark12,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Txt f="sansSemi" size={16} color={C.white}>
              ✕
            </Txt>
          </Pressable>
        </View>
      ) : null}

      {phase === 'live' ? (
        <View style={{ flexDirection: 'row', gap: 14, alignSelf: 'stretch' }}>
          <PrimaryButton
            label={L.endCall}
            onPress={() => void endCall()}
            color={C.red}
            height={66}
            style={{ flex: 1 }}
          />
          <Pressable
            onPress={() => openSheet('wa')}
            style={{
              width: 66,
              height: 66,
              borderRadius: 20,
              backgroundColor: C.onDark12,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <WhatsAppIcon size={24} />
          </Pressable>
        </View>
      ) : null}

      {phase === 'outcome' ? (
        <View style={{ alignSelf: 'stretch', gap: 8 }}>
          <Txt f="sansSemi" size={13} color={C.onDark50} style={{ marginBottom: 4 }} align="center">
            {L.callNote}
          </Txt>
          <OutcomeButton label={L.outcomeAnswered} color={C.greenDeep} onPress={() => void finish('answered')} />
          <OutcomeButton label={L.outcomeNoAnswer} color={C.amber} onPress={() => void finish('noanswer')} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <OutcomeButton
              label={L.outcomeWrongNumber}
              color={C.onDark12}
              onPress={() => void finish('wrongnumber')}
              style={{ flex: 1 }}
            />
            <OutcomeButton
              label={L.outcomeRefused}
              color={C.red}
              onPress={() => void finish('refused')}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function OutcomeButton({
  label,
  color,
  onPress,
  style,
}: {
  label: string;
  color: string;
  onPress: () => void;
  style?: object;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          height: 52,
          borderRadius: R.cardLg,
          backgroundColor: color,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.8 : 1,
        },
        style,
      ]}
    >
      <Txt f="sansSemi" size={15} color={C.white}>
        {label}
      </Txt>
    </Pressable>
  );
}
