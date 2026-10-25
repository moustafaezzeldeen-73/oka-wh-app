import { Image } from 'expo-image';
import * as Linking from 'expo-linking';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';

import { PhoneIcon, WhatsAppIcon } from '../components/Icons';
import { ActionTile, BackButton, Card, EmptyState, Mono, Txt } from '../components/primitives';
import { fetchTracking, phaseFromTimeline, timesFromTimeline } from '../api/bosta';
import {
  jtCourier,
  jtEvents,
  jtOpenProblem,
  jtPhase,
  jtPhaseTimes,
  shipmentFor,
  type JtEvent,
  type JtProblem,
} from '../api/jt';
import type { Order } from '../api/model';
import { PHASES, type Strings } from '../i18n/strings';
import { useApp } from '../state/AppState';
import { C, GUTTER, R } from '../theme/tokens';

type LiveTracking = {
  times: (string | null)[];
  phase: number;
  loading: boolean;
  courier: { name: string; phone: string } | null;
  problem: JtProblem | null;
  events: JtEvent[];
};

/**
 * Tracking for an AWB, refreshed from the courier when the screen opens.
 *
 * The order list already carries what the list payloads returned; this
 * refetches the single parcel — Bosta's full `timeline`, or J&T's complete
 * scan history — and upgrades the display once it lands.
 */
export function useLiveTracking(order: Order): LiveTracking {
  const [live, setLive] = useState<Omit<LiveTracking, 'loading'>>({
    times: order.phaseTimes,
    phase: order.trackPhase,
    courier: order.courier,
    problem: order.problem,
    events: order.events,
  });
  const [loading, setLoading] = useState(false);
  const { awb, carrier } = order;

  useEffect(() => {
    if (!awb || !carrier) return;
    let alive = true;
    setLoading(true);
    const job =
      carrier === 'jt'
        ? shipmentFor(awb).then((s) => {
            if (!alive || !s) return;
            setLive({
              times: jtPhaseTimes(s),
              phase: jtPhase(s),
              courier: jtCourier(s),
              problem: jtOpenProblem(s),
              events: jtEvents(s),
            });
          })
        : fetchTracking(awb).then((d) => {
            if (!alive || !d?.timeline) return;
            const p = phaseFromTimeline(d.timeline);
            setLive((cur) => ({
              ...cur,
              times: timesFromTimeline(d.timeline),
              phase: p ?? cur.phase,
            }));
          });
    job
      .catch(() => undefined)
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [awb, carrier]);

  return { ...live, loading };
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
  const { times, phase, loading, courier, problem, events } = useLiveTracking(order);
  const branchPhone = events.find((e) => e.branchPhone)?.branchPhone ?? null;

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
        {order.carrierName ? (
          <Txt f="sansSemi" size={12} color={C.ink45} style={{ marginBottom: 6, paddingHorizontal: 2 }}>
            {order.carrierName}
            {order.attempts > 0 ? ` · ${L.attempts}: ${order.attempts}` : ''}
          </Txt>
        ) : null}

        {problem ? <ProblemCard problem={problem} L={L} /> : null}

        <Timeline phase={phase} times={times} ar={ar} dotSize={18} />

        <Txt
          f="sansSemi"
          size={13}
          color={C.ink50}
          style={{ marginTop: 8, marginBottom: 8, paddingHorizontal: 2 }}
        >
          {L.courier}
        </Txt>

        {courier ? (
          <CourierCard
            name={courier.name}
            phone={courier.phone}
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

        {branchPhone ? (
          <Card
            onPress={() => void Linking.openURL(`tel:${branchPhone}`).catch(() => undefined)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13, marginTop: 8 }}
          >
            <PhoneIcon size={18} color={C.greenDeep} />
            <Txt f="sansSemi" size={13} style={{ flex: 1 }}>
              {L.branchPhone}
            </Txt>
            <Mono f="monoMedium" size={13} color={C.ink50}>
              {branchPhone}
            </Mono>
          </Card>
        ) : null}

        {order.carrier === 'jt' ? (
          <>
            <Txt
              f="sansSemi"
              size={13}
              color={C.ink50}
              style={{ marginTop: 20, marginBottom: 8, paddingHorizontal: 2 }}
            >
              {L.scanHistory}
            </Txt>
            <ScanHistory events={events} L={L} />
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

/** Fill the {place}/{next}/{courier} slots in an event template. */
export function eventTitle(e: JtEvent, L: Strings): string {
  const fill = (t: string) =>
    t
      .replace('{place}', e.place || e.city)
      .replace('{next}', e.next || '—')
      .replace('{courier}', e.courier?.name ?? '—');
  switch (e.kind) {
    case 'pickup':
      return L.evPickup;
    case 'departed':
      return fill(L.evDeparted);
    case 'arrived':
      return fill(L.evArrived);
    case 'delivering':
      return fill(L.evDelivering);
    case 'delivered':
      return L.evDelivered;
    case 'problem':
      return `${L.evProblem}: ${e.problem?.reason ?? ''}`.trim();
    case 'returned':
      return L.evReturned;
    default:
      return e.text;
  }
}

function PhotoStrip({ urls }: { urls: string[] }) {
  if (urls.length === 0) return null;
  return (
    <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
      {urls.map((u) => (
        <Pressable key={u} onPress={() => void Linking.openURL(u).catch(() => undefined)}>
          <Image
            source={{ uri: u }}
            style={{ width: 64, height: 64, borderRadius: R.tile, backgroundColor: C.surfaceImage }}
            contentFit="cover"
          />
        </Pressable>
      ))}
    </View>
  );
}

/** The courier's latest failed attempt, with J&T's reason and the courier's own note. */
export function ProblemCard({ problem, L }: { problem: JtProblem; L: Strings }) {
  return (
    <View
      style={{
        backgroundColor: '#F7EBEB',
        borderRadius: R.card,
        padding: 14,
        marginBottom: 10,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Txt f="sansSemi" size={13} color={C.red} style={{ flex: 1 }}>
          {L.deliveryProblem}
        </Txt>
        <Mono f="monoMedium" size={11} color={C.red}>
          {formatStamp(problem.at)}
        </Mono>
      </View>
      <Txt f="sansSemi" size={14} color={C.ink} style={{ marginTop: 6 }}>
        {problem.reason}
      </Txt>
      {problem.note ? (
        <Txt size={13} color={C.ink60} style={{ marginTop: 3 }}>
          {problem.note}
        </Txt>
      ) : null}
      {problem.place ? (
        <Txt size={11} color={C.ink45} style={{ marginTop: 4 }}>
          {problem.place}
        </Txt>
      ) : null}
      <PhotoStrip urls={problem.photos} />
    </View>
  );
}

/** J&T's scan-by-scan history, newest first, with signature and problem photos. */
export function ScanHistory({ events, L }: { events: JtEvent[]; L: Strings }) {
  if (events.length === 0) return <EmptyState text={L.noScans} />;
  return (
    <Card style={{ paddingVertical: 6, paddingHorizontal: 14 }}>
      {events.map((e, i) => {
        const tone =
          e.kind === 'problem' || e.kind === 'returned'
            ? C.red
            : e.kind === 'delivered'
              ? C.greenDeep
              : C.ink;
        return (
          <View
            key={`${e.at}-${i}`}
            style={{
              paddingVertical: 11,
              borderTopWidth: i === 0 ? 0 : 1,
              borderTopColor: C.border,
            }}
          >
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
              <Txt f="sansSemi" size={13} color={tone} style={{ flex: 1 }}>
                {eventTitle(e, L)}
              </Txt>
              <Mono f="monoMedium" size={11} color={C.ink40}>
                {formatStamp(e.at)}
              </Mono>
            </View>
            {e.kind === 'problem' && e.problem?.note ? (
              <Txt size={12} color={C.ink60} style={{ marginTop: 3 }}>
                {e.problem.note}
              </Txt>
            ) : null}
            {e.kind !== 'departed' && e.kind !== 'arrived' && (e.place || e.city) ? (
              <Txt size={11} color={C.ink45} style={{ marginTop: 3 }}>
                {[e.place, e.city].filter(Boolean).join(' · ')}
              </Txt>
            ) : null}
            {e.otp ? (
              <Mono f="monoMedium" size={11} color={C.ink50} style={{ marginTop: 3 }}>
                {L.otp}: {e.otp}
              </Mono>
            ) : null}
            <PhotoStrip urls={e.photos} />
          </View>
        );
      })}
    </Card>
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
