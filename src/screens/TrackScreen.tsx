import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';

import { PhoneIcon, WhatsAppIcon } from '../components/Icons';
import { ActionTile, BackButton, Card, EmptyState, Mono, Txt } from '../components/primitives';
import { fetchTracking, phaseFromTimeline, timesFromTimeline } from '../api/bosta';
import type { Order } from '../api/model';
import { PHASES } from '../i18n/strings';
import { useApp } from '../state/AppState';
import { C, GUTTER, R } from '../theme/tokens';

/**
 * Per-phase timestamps for an AWB.
 *
 * The order list already carries `phaseTimes` from whatever Bosta returned with
 * the list payload; this refetches the single delivery, whose response includes
 * the full `timeline`, and upgrades the display once it lands.
 */
export function usePhaseTimes(order: Order) {
  const [times, setTimes] = useState<(string | null)[]>(order.phaseTimes);
  const [phase, setPhase] = useState<number>(order.trackPhase);
  const [loading, setLoading] = useState(false);
  const awb = order.awb;

  useEffect(() => {
    if (!awb) return;
    let alive = true;
    setLoading(true);
    fetchTracking(awb)
      .then((d) => {
        if (!alive || !d?.timeline) return;
        setTimes(timesFromTimeline(d.timeline));
        const p = phaseFromTimeline(d.timeline);
        if (p !== null) setPhase(p);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [awb]);

  return { times, phase, loading };
}

export function formatStamp(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', {
    timeZone: 'Africa/Cairo',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function TrackScreen({ order }: { order: Order }) {
  const { L, ar, go, openSheet, setContactTarget } = useApp();
  const { times, phase, loading } = usePhaseTimes(order);

  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingTop: 4,
          paddingHorizontal: GUTTER,
          paddingBottom: 14,
        }}
      >
        <BackButton onPress={() => go('detail')} ar={ar} />
        <Txt f="sansSemi" size={19}>
          {L.trackTitle}
        </Txt>
        <View style={{ flex: 1 }} />
        {loading ? <ActivityIndicator size="small" color={C.green} /> : null}
        <Mono f="monoMedium" size={12} color={C.ink40}>
          {order.awb ?? order.name}
        </Mono>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        <Timeline phase={phase} times={times} ar={ar} dotSize={18} />

        <Txt
          f="sansSemi"
          size={13}
          color={C.ink50}
          style={{ marginTop: 8, marginBottom: 8, paddingHorizontal: 2 }}
        >
          {L.courier}
        </Txt>

        {order.courier ? (
          <CourierCard
            name={order.courier.name}
            phone={order.courier.phone}
            L={L}
            onCall={() => {
              setContactTarget('courier');
              openSheet('call');
            }}
            onWa={() => {
              setContactTarget('courier');
              openSheet('wa');
            }}
          />
        ) : (
          <EmptyState text={L.noCourier} />
        )}
      </ScrollView>
    </View>
  );
}

export function Timeline({
  phase,
  times,
  ar,
  dotSize = 18,
}: {
  phase: number;
  times: (string | null)[];
  ar: boolean;
  dotSize?: number;
}) {
  return (
    <Card style={{ paddingTop: 22, paddingHorizontal: 20, paddingBottom: 6, marginTop: 6, borderRadius: R.panel }}>
      {PHASES.map((p, i) => {
        const done = i < phase;
        const current = i === phase;
        const reached = i <= phase;
        const isLast = i === PHASES.length - 1;
        return (
          <View key={p.en} style={{ flexDirection: 'row', gap: 14 }}>
            <View style={{ alignItems: 'center' }}>
              <View
                style={{
                  width: dotSize,
                  height: dotSize,
                  borderRadius: dotSize / 2,
                  backgroundColor: done ? C.greenDeep : current ? C.green : C.white,
                  borderWidth: 2.5,
                  borderColor: reached ? C.greenDeep : C.borderTrackDot,
                }}
              />
              {!isLast ? (
                <View
                  style={{
                    width: 2,
                    flex: 1,
                    backgroundColor: done ? C.greenDeep : 'rgba(0,0,0,0.12)',
                    marginVertical: 2,
                  }}
                />
              ) : null}
            </View>
            <View style={{ flex: 1, paddingBottom: 26, minWidth: 0 }}>
              <Txt f="sansSemi" size={15} color={reached ? C.ink : C.ink35}>
                {ar ? p.ar : p.en}
              </Txt>
              <Mono f="monoMedium" size={12} color={C.ink40} style={{ marginTop: 3 }}>
                {formatStamp(times[i])}
              </Mono>
            </View>
          </View>
        );
      })}
    </Card>
  );
}

export function CourierCard({
  name,
  phone,
  L,
  onCall,
  onWa,
  compact = false,
}: {
  name: string;
  phone: string;
  L: { callCourier: string; waCourier: string };
  onCall: () => void;
  onWa: () => void;
  compact?: boolean;
}) {
  const avatar = compact ? 40 : 44;
  const initials =
    name
      .trim()
      .split(/\s+/)
      .map((w) => w[0] ?? '')
      .slice(0, 2)
      .join('') || '—';

  return (
    <Card style={{ padding: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View
          style={{
            width: avatar,
            height: avatar,
            borderRadius: compact ? 12 : R.tileLg,
            backgroundColor: C.ink,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Mono size={compact ? 13 : 14} color={C.white}>
            {initials}
          </Mono>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt f="sansSemi" size={compact ? 15 : 16}>
            {name}
          </Txt>
          <Mono f="monoMedium" size={compact ? 12 : 13} color={C.ink50} style={{ marginTop: 2 }}>
            {phone}
          </Mono>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
        <ActionTile
          label={L.callCourier}
          icon={<PhoneIcon size={20} />}
          bg={C.greenDeep}
          fg={C.white}
          onPress={onCall}
        />
        <ActionTile
          label={L.waCourier}
          icon={<WhatsAppIcon size={20} />}
          bg={C.ink}
          fg={C.white}
          onPress={onWa}
        />
      </View>
    </Card>
  );
}
