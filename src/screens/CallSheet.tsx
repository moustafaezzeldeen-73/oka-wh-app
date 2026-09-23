import * as Linking from 'expo-linking';
import { useKeepAwake } from 'expo-keep-awake';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, View } from 'react-native';

import { WhatsAppIcon } from '../components/Icons';
import { Mono, PrimaryButton, Txt } from '../components/primitives';
import type { CallOutcome } from '../api/activity';
import { money, type Order } from '../api/model';
import {
  canFindAutomatically,
  chooseRecordingFile,
  findCallRecording,
  type RecordingFile,
} from '../device/callRecordings';
import { useApp } from '../state/AppState';
import { C, R } from '../theme/tokens';

/**
 * Call screen.
 *
 * An ordinary app can't record a phone call, but most Android phones record
 * every call themselves. So the app places the call, and afterwards picks up
 * the phone's own recording: found automatically in a real Android build
 * (matched by time and number), or chosen with the system file picker in Expo
 * Go and on iPhone. The recording is uploaded to Shopify under a name tied to
 * the order, transcribed by Gemini, and logged on the order with the outcome.
 */

type Phase = 'idle' | 'live' | 'outcome' | 'recording';

type RecordingState =
  | { status: 'searching' }
  | { status: 'ready'; file: RecordingFile }
  | { status: 'none' | 'denied' | 'manual' };

export function CallSheet({ order }: { order: Order }) {
  const { L, openSheet, contactTarget, logCall, setContactTarget } = useApp();
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

  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [outcome, setOutcome] = useState<CallOutcome | null>(null);
  const [recording, setRecording] = useState<RecordingState>({ status: 'manual' });
  const startedAt = useRef<number>(0);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);
  const alive = useRef(true);

  useEffect(
    () => () => {
      alive.current = false;
      if (ticker.current) clearInterval(ticker.current);
    },
    [],
  );

  const startCall = useCallback(() => {
    startedAt.current = Date.now();
    setElapsed(0);
    ticker.current = setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)),
      1000,
    );
    setPhase('live');
    Linking.openURL(`tel:${phone}`).catch(() => undefined);
  }, [phone]);

  const endCall = useCallback(() => {
    if (ticker.current) {
      clearInterval(ticker.current);
      ticker.current = null;
    }
    setPhase('outcome');
  }, []);

  const lookForRecording = useCallback(async () => {
    if (!canFindAutomatically) {
      setRecording({ status: 'manual' });
      return;
    }
    setRecording({ status: 'searching' });
    try {
      const res = await findCallRecording({ phone, startedAt: startedAt.current });
      if (!alive.current) return;
      if (res.status === 'found') setRecording({ status: 'ready', file: res.file });
      else if (res.status === 'denied') setRecording({ status: 'denied' });
      else setRecording({ status: 'none' });
    } catch {
      if (alive.current) setRecording({ status: 'none' });
    }
  }, [phone]);

  const pickOutcome = useCallback(
    (o: CallOutcome) => {
      setOutcome(o);
      setPhase('recording');
      void lookForRecording();
    },
    [lookForRecording],
  );

  const chooseFile = useCallback(async () => {
    const file = await chooseRecordingFile();
    if (file && alive.current) setRecording({ status: 'ready', file });
  }, []);

  const save = useCallback(
    async (file: RecordingFile | null) => {
      if (!outcome) return;
      openSheet(null);
      setContactTarget('customer');
      await logCall(order, {
        target: isCourier ? 'courier' : 'customer',
        phone,
        contactName: name,
        startedAt: startedAt.current,
        timerSec: elapsed,
        outcome,
        recording: file,
      });
    },
    [elapsed, isCourier, logCall, name, openSheet, order, outcome, phone, setContactTarget],
  );

  const mmss = (sec: number) =>
    `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;

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
            backgroundColor: 'rgba(176,42,42,0.18)',
          }}
        >
          <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: C.recordDot }} />
          <Txt f="sansSemi" size={13} color={C.recordText}>
            {/* The phone's own recorder is capturing the call on Android. */}
            {Platform.OS === 'android' ? L.recording : L.callInProgress}
          </Txt>
          <Mono f="monoMedium" size={13} color={C.onDark60}>
            {mmss(elapsed)}
          </Mono>
        </View>
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
            onPress={startCall}
            color={C.greenDeep}
            height={66}
            style={{ flex: 1 }}
          />
          <SquareButton onPress={() => openSheet(null)}>
            <Txt f="sansSemi" size={16} color={C.white}>
              ✕
            </Txt>
          </SquareButton>
        </View>
      ) : null}

      {phase === 'live' ? (
        <View style={{ flexDirection: 'row', gap: 14, alignSelf: 'stretch' }}>
          <PrimaryButton label={L.endCall} onPress={endCall} color={C.red} height={66} style={{ flex: 1 }} />
          <SquareButton onPress={() => openSheet('wa')}>
            <WhatsAppIcon size={24} />
          </SquareButton>
        </View>
      ) : null}

      {phase === 'outcome' ? (
        <View style={{ alignSelf: 'stretch', gap: 8 }}>
          <Txt f="sansSemi" size={13} color={C.onDark50} style={{ marginBottom: 4 }} align="center">
            {L.callNote}
          </Txt>
          <OutcomeButton label={L.outcomeAnswered} color={C.greenDeep} onPress={() => pickOutcome('answered')} />
          <OutcomeButton label={L.outcomeNoAnswer} color={C.amber} onPress={() => pickOutcome('noanswer')} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <OutcomeButton
              label={L.outcomeWrongNumber}
              color={C.onDark12}
              onPress={() => pickOutcome('wrongnumber')}
              style={{ flex: 1 }}
            />
            <OutcomeButton
              label={L.outcomeRefused}
              color={C.red}
              onPress={() => pickOutcome('refused')}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      ) : null}

      {phase === 'recording' ? (
        <View style={{ alignSelf: 'stretch', gap: 8 }}>
          <RecordingStatus state={recording} L={L} mmss={mmss} />
          {recording.status === 'ready' ? (
            <OutcomeButton
              label={L.attachAndSave}
              color={C.greenDeep}
              onPress={() => void save(recording.file)}
            />
          ) : null}
          {recording.status !== 'searching' ? (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <OutcomeButton
                label={L.chooseFile}
                color={C.onDark12}
                onPress={() => void chooseFile()}
                style={{ flex: 1 }}
              />
              <OutcomeButton
                label={L.saveWithoutRecording}
                color={C.onDark12}
                onPress={() => void save(null)}
                style={{ flex: 1 }}
              />
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function RecordingStatus({
  state,
  L,
  mmss,
}: {
  state: RecordingState;
  L: ReturnType<typeof useApp>['L'];
  mmss: (s: number) => string;
}) {
  const box = {
    backgroundColor: C.onDark06,
    borderRadius: R.cardLg,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 4,
  } as const;

  if (state.status === 'searching') {
    return (
      <View style={[box, { flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
        <ActivityIndicator color={C.green} />
        <Txt f="sansSemi" size={14} color={C.white}>
          {L.findingRecording}
        </Txt>
      </View>
    );
  }
  if (state.status === 'ready') {
    const f = state.file;
    const time = f.createdAt
      ? new Date(f.createdAt).toLocaleTimeString('en-GB', {
          timeZone: 'Africa/Cairo',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        })
      : '';
    return (
      <View style={box}>
        <Txt f="sansSemi" size={12} color={C.onDark50} style={{ marginBottom: 6 }}>
          {L.recordingFound}
        </Txt>
        <Txt size={14} color={C.white} numberOfLines={2}>
          {f.name}
        </Txt>
        <Mono f="monoMedium" size={12} color={C.onDark55} style={{ marginTop: 4 }}>
          {[f.durationSec !== null ? mmss(f.durationSec) : '', time].filter(Boolean).join(' · ')}
        </Mono>
      </View>
    );
  }
  const text =
    state.status === 'denied'
      ? L.recordingDenied
      : state.status === 'none'
        ? L.noRecordingFound
        : L.pickRecordingHint;
  return (
    <View style={box}>
      <Txt f="sansSemi" size={14} color={C.white} align="center">
        {text}
      </Txt>
    </View>
  );
}

function SquareButton({ onPress, children }: { onPress: () => void; children: React.ReactNode }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        width: 66,
        height: 66,
        borderRadius: 20,
        backgroundColor: C.onDark12,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {children}
    </Pressable>
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
