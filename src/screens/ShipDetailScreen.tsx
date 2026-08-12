import React from 'react';
import { ScrollView, View } from 'react-native';

import { BackButton, Card, EmptyState, Mono, Thumb, Txt } from '../components/primitives';
import type { Order } from '../api/model';
import { useApp } from '../state/AppState';
import { contactHistory } from '../state/selectors';
import { C, GUTTER, R } from '../theme/tokens';
import { HistoryRow } from './OrderDetailScreen';
import { CourierCard, Timeline, usePhaseTimes } from './TrackScreen';

/** Read-only shipment view reached from the phone search. */
export function ShipDetailScreen({ order }: { order: Order }) {
  const { L, ar, go, openSheet, setContactTarget } = useApp();
  const { times, phase } = usePhaseTimes(order);
  const history = contactHistory(order);

  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingTop: 4,
          paddingHorizontal: GUTTER,
          paddingBottom: 12,
        }}
      >
        <BackButton onPress={() => go('shipstatus')} ar={ar} />
        <Txt f="sansSemi" size={17} numberOfLines={1} style={{ flex: 1 }}>
          {order.customerName}
        </Txt>
        <Mono f="monoMedium" size={12} color={C.ink40}>
          {order.awb ?? order.name}
        </Mono>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        <Txt f="sansSemi" size={15} style={{ marginHorizontal: 2, marginTop: 2, marginBottom: 9 }}>
          {L.contents}
        </Txt>
        <View style={{ gap: 8 }}>
          {order.items.map((it) => (
            <Card
              key={it.lineItemId}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 11 }}
            >
              <Thumb uri={it.image} size={40} radius={10} />
              <Txt f="sansSemi" size={13} style={{ flex: 1 }} numberOfLines={2}>
                {it.title}
              </Txt>
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 9,
                  backgroundColor: C.surfaceMuted,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Mono size={14}>{it.quantity}</Mono>
              </View>
            </Card>
          ))}
        </View>

        <Txt f="sansSemi" size={13} color={C.ink50} style={{ marginTop: 20, marginBottom: 8, marginHorizontal: 2 }}>
          {L.trackTitle}
        </Txt>
        <Timeline phase={phase} times={times} ar={ar} dotSize={16} />

        <Txt f="sansSemi" size={13} color={C.ink50} style={{ marginTop: 20, marginBottom: 8, marginHorizontal: 2 }}>
          {L.courier}
        </Txt>
        {order.courier ? (
          <CourierCard
            compact
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

        <Txt f="sansSemi" size={13} color={C.ink50} style={{ marginTop: 20, marginBottom: 8, marginHorizontal: 2 }}>
          {L.history}
        </Txt>
        <View style={{ gap: 7 }}>
          {history.length === 0 ? (
            <EmptyState text={L.noHistory} />
          ) : (
            history.slice(0, 8).map((h) => <HistoryRow key={h.id} entry={h} />)
          )}
        </View>

        <View style={{ height: R.panel }} />
      </ScrollView>
    </View>
  );
}
