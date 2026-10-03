import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  TextInput,
  View,
} from 'react-native';

import { Chip, Card, Mono, Thumb, Txt } from '../components/primitives';
import { SearchIcon } from '../components/Icons';
import { money, type CarrierKey, type Order } from '../api/model';
import { searchOrders } from '../api/repository';
import { FILTER_KEYS, FILTER_LABELS } from '../i18n/strings';
import { useApp } from '../state/AppState';
import { applyFilter } from '../state/selectors';
import { C, F, GUTTER, R } from '../theme/tokens';

export function OrdersListScreen() {
  const {
    orders,
    loading,
    refreshing,
    refresh,
    error,
    filter,
    setFilter,
    query,
    setQuery,
    lang,
    setLang,
    ar,
    L,
    select,
    go,
    configured,
    configGaps,
    courierNotices,
  } = useApp();

  const visible = useMemo(
    () => searchOrders(applyFilter(orders, FILTER_KEYS[filter]), query),
    [orders, filter, query],
  );

  const openOrder = (o: Order) => {
    select(o.shopifyId);
    go('detail');
  };

  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      {/* ── header ── */}
      <View style={{ paddingTop: 4, paddingHorizontal: GUTTER, paddingBottom: 14 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 14,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
            <Txt f="sansSemi" size={22} lh={22}>
              {L.orders}
            </Txt>
            <Mono f="monoMedium" size={13} color={C.ink40}>
              {visible.length}
            </Mono>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View
              style={{
                flexDirection: 'row',
                backgroundColor: C.ink06,
                borderRadius: 9,
                padding: 2,
              }}
            >
              <Pressable
                onPress={() => setLang('ar')}
                style={{
                  paddingHorizontal: 11,
                  paddingVertical: 5,
                  borderRadius: 7,
                  backgroundColor: ar ? C.ink : 'transparent',
                }}
              >
                <Txt f="sansSemi" size={12} color={ar ? C.white : C.ink50}>
                  ع
                </Txt>
              </Pressable>
              <Pressable
                onPress={() => setLang('en')}
                style={{
                  paddingHorizontal: 11,
                  paddingVertical: 5,
                  borderRadius: 7,
                  backgroundColor: ar ? 'transparent' : C.ink,
                }}
              >
                <Mono f="monoSemi" size={12} color={ar ? C.ink50 : C.white}>
                  EN
                </Mono>
              </Pressable>
            </View>

            <Pressable
              onPress={refresh}
              style={{
                width: 34,
                height: 34,
                borderRadius: 11,
                backgroundColor: C.ink,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {refreshing ? (
                <ActivityIndicator size="small" color={C.white} />
              ) : (
                <Mono f="monoSemi" size={12} color={C.white}>
                  OKA
                </Mono>
              )}
            </Pressable>
          </View>
        </View>

        {/* ── search ── */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            backgroundColor: C.surface,
            borderWidth: 1,
            borderColor: C.borderStrong,
            borderRadius: R.card,
            paddingHorizontal: 14,
            height: 52,
          }}
        >
          <SearchIcon />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={L.search}
            placeholderTextColor={C.ink38}
            style={{
              flex: 1,
              fontFamily: F.sans,
              fontSize: 15,
              color: C.ink,
              textAlign: ar ? 'right' : 'left',
              padding: 0,
            }}
          />
        </View>

        {/* ── filters ── */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginTop: 12 }}
          contentContainerStyle={{ gap: 8 }}
        >
          {FILTER_LABELS[lang].map((label, i) => (
            <Pressable
              key={label}
              onPress={() => setFilter(i)}
              style={{
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: R.pill,
                backgroundColor: filter === i ? C.ink : C.ink06,
              }}
            >
              <Txt f="sansSemi" size={13} color={filter === i ? C.white : C.ink60}>
                {label}
              </Txt>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* ── body ── */}
      {!configured ? (
        <ConfigGate gaps={configGaps} title={L.configMissing} hint={L.configMissingHint} />
      ) : loading ? (
        <Loading label={L.loadingOrders} />
      ) : error ? (
        <ErrorState title={L.errorTitle} message={error} retry={L.retry} onRetry={refresh} />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(o) => o.shopifyId}
          contentContainerStyle={{
            paddingHorizontal: GUTTER,
            paddingBottom: 110,
            gap: 10,
          }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.green} />
          }
          ListEmptyComponent={
            <View style={{ paddingTop: 40, alignItems: 'center' }}>
              <Txt f="sansMedium" size={14} color={C.ink40}>
                {L.noOrders}
              </Txt>
            </View>
          }
          ListHeaderComponent={
            courierNotices.length > 0 ? (
              <CourierNotices title={L.courierNotice} notices={courierNotices} />
            ) : null
          }
          renderItem={({ item }) => <OrderRow order={item} ar={ar} L={L} onPress={openOrder} />}
        />
      )}
    </View>
  );
}

function OrderRow({
  order,
  ar,
  L,
  onPress,
}: {
  order: Order;
  ar: boolean;
  L: { items: string };
  onPress: (o: Order) => void;
}) {
  return (
    <Card
      onPress={() => onPress(order)}
      style={{
        padding: 14,
        flexDirection: 'row',
        gap: 13,
        alignItems: 'center',
      }}
    >
      <Thumb uri={order.thumb} size={52} radius={12} />

      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Mono size={19} lh={19} ls={-0.4} numberOfLines={1} style={{ flexShrink: 1 }}>
            {order.awb ?? order.name}
          </Mono>
          <Chip status={order.status} ar={ar} />
          {order.carrier ? <CarrierTag carrier={order.carrier} /> : null}
        </View>
        <Txt size={13} color={C.ink55} numberOfLines={1}>
          {order.customerName} · {order.city}
        </Txt>
        {order.problem ? (
          <Txt f="sansMedium" size={12} color={C.red} numberOfLines={1} style={{ marginTop: 2 }}>
            {order.problem.note || order.problem.reason}
          </Txt>
        ) : order.codMismatch ? (
          <Mono f="monoMedium" size={11} color={C.amber} style={{ marginTop: 2 }}>
            COD {money(order.codMismatch.courier)} ≠ {money(order.codMismatch.shopify)}
          </Mono>
        ) : null}
      </View>

      <View style={{ alignItems: ar ? 'flex-start' : 'flex-end' }}>
        <Mono size={16}>{money(order.cod)}</Mono>
        <Txt f="sansMedium" size={11} color={C.ink40} style={{ marginTop: 3 }}>
          {order.itemCount} {L.items}
        </Txt>
      </View>
    </Card>
  );
}

const CARRIER_TAG: Record<CarrierKey, { label: string; color: string; border: string }> = {
  jt: { label: 'J&T', color: C.red, border: C.red },
  bosta: { label: 'BOSTA', color: C.ink55, border: C.borderInput },
  inhouse: { label: 'OKA', color: C.greenDeep, border: C.greenDeep },
};

/** Who carries the parcel — J&T in its red, Bosta in ink, OKA's own truck in green. */
function CarrierTag({ carrier }: { carrier: CarrierKey }) {
  const t = CARRIER_TAG[carrier];
  return (
    <View
      style={{
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: R.chip,
        borderWidth: 1,
        borderColor: t.border,
      }}
    >
      <Mono f="monoMedium" size={10} color={t.color}>
        {t.label}
      </Mono>
    </View>
  );
}

/** A courier without keys, or one that failed to answer on the last refresh. */
function CourierNotices({ title, notices }: { title: string; notices: string[] }) {
  return (
    <View
      style={{
        backgroundColor: '#F6EFE4',
        borderRadius: R.card,
        paddingVertical: 10,
        paddingHorizontal: 13,
        marginBottom: 2,
      }}
    >
      <Txt f="sansSemi" size={12} color={C.amber}>
        {title}
      </Txt>
      {notices.map((n) => (
        <Txt key={n} size={11} color={C.amber} style={{ marginTop: 3 }}>
          {n}
        </Txt>
      ))}
    </View>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 }}>
      <ActivityIndicator size="large" color={C.green} />
      <Txt f="sansMedium" size={14} color={C.ink45} align="center" style={{ paddingHorizontal: 40 }}>
        {label}
      </Txt>
    </View>
  );
}

export function ErrorState({
  title,
  message,
  retry,
  onRetry,
}: {
  title: string;
  message: string;
  retry: string;
  onRetry: () => void;
}) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 }}>
      <Txt f="sansSemi" size={17} color={C.red}>
        {title}
      </Txt>
      <Txt size={13} lh={20} color={C.ink50} align="center">
        {message}
      </Txt>
      <Pressable
        onPress={onRetry}
        style={{
          marginTop: 8,
          paddingHorizontal: 24,
          height: 46,
          borderRadius: R.card,
          backgroundColor: C.ink,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Txt f="sansMedium" size={15} color={C.white}>
          {retry}
        </Txt>
      </Pressable>
    </View>
  );
}

export function ConfigGate({
  gaps,
  title,
  hint,
}: {
  gaps: string[];
  title: string;
  hint: string;
}) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 }}>
      <Txt f="sansSemi" size={18} color={C.amber}>
        {title}
      </Txt>
      <Txt size={13} lh={20} color={C.ink50} align="center">
        {hint}
      </Txt>
      <View
        style={{
          marginTop: 8,
          backgroundColor: C.surface,
          borderWidth: 1,
          borderColor: C.border,
          borderRadius: R.card,
          padding: 14,
          gap: 6,
          alignSelf: 'stretch',
        }}
      >
        {gaps.map((g) => (
          <Mono key={g} f="monoMedium" size={12} color={C.red}>
            {g}
          </Mono>
        ))}
      </View>
    </View>
  );
}
