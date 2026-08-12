import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import React from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';

import { Barcode } from '../components/Barcode';
import {
  CameraIcon,
  CancelIcon,
  CheckIcon,
  EditIcon,
  PhoneIcon,
  WhatsAppIcon,
} from '../components/Icons';
import {
  ActionTile,
  BackButton,
  Card,
  Chip,
  Divider,
  EmptyState,
  Mono,
  PrimaryButton,
  Thumb,
  Txt,
} from '../components/primitives';
import { money, type Order } from '../api/model';
import { useApp } from '../state/AppState';
import { contactHistory, orderPhotos } from '../state/selectors';
import { C, GUTTER, R, clarityColor, rankColor } from '../theme/tokens';

export function OrderDetailScreen({ order }: { order: Order }) {
  const {
    L,
    ar,
    go,
    openSheet,
    setContactTarget,
    markReady,
    cancelOrder,
    resetDraft,
    showToast,
    busy,
  } = useApp();

  const photos = orderPhotos(order);
  const history = contactHistory(order);
  const editable = !order.locked;

  const confirmCancel = () => {
    Alert.alert(L.cancelOrder, `${L.confirmCancel}\n${order.name} · ${order.awb ?? ''}`, [
      { text: L.no, style: 'cancel' },
      { text: L.yes, style: 'destructive', onPress: () => void cancelOrder(order) },
    ]);
  };

  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      {/* ── header ── */}
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
        <BackButton onPress={() => go('list')} ar={ar} />
        <Chip status={order.status} ar={ar} style={{ paddingHorizontal: 9, paddingVertical: 4 }} />
        <View style={{ flex: 1 }} />
        <Mono f="monoMedium" size={12} color={C.ink40}>
          {order.name}
        </Mono>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── AWB ── */}
        <Card style={{ padding: 18, alignItems: 'center', borderRadius: R.panel }}>
          <Txt f="sansMedium" size={11} color={C.ink40} ls={0.66}>
            {L.awb} · {order.carrier}
          </Txt>
          <Pressable
            onPress={() => {
              if (!order.awb) return;
              void Clipboard.setStringAsync(order.awb);
              showToast(L.awbCopied);
            }}
          >
            <Mono size={30} lh={36} ls={-1} style={{ marginTop: 4, marginBottom: 12 }}>
              {order.awb ?? '—'}
            </Mono>
          </Pressable>
          <Barcode value={order.awb} height={44} color={C.ink} />
        </Card>

        {/* ── track ── */}
        <Card
          onPress={() => go('track')}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            paddingVertical: 13,
            paddingHorizontal: 15,
            marginTop: 12,
            borderRadius: R.card,
          }}
        >
          <View
            style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.green }}
          />
          <Txt f="sansSemi" size={14} style={{ flex: 1 }}>
            {L.track} · {ar ? order.trackPhaseLabel.ar : order.trackPhaseLabel.en}
          </Txt>
          <Mono size={15} color={C.ink35}>
            {ar ? '←' : '→'}
          </Mono>
        </Card>

        {/* ── destructive + ready ── */}
        {order.status !== 'cancelled' ? (
          <Pressable
            onPress={confirmCancel}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              backgroundColor: C.red,
              borderRadius: R.card,
              paddingVertical: 13,
              paddingHorizontal: 15,
              marginTop: 8,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <CancelIcon size={16} />
            <Txt f="sansSemi" size={14} color={C.white}>
              {L.cancelOrder}
            </Txt>
          </Pressable>
        ) : null}

        <Pressable
          onPress={() => void markReady(order)}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            backgroundColor: C.green,
            borderRadius: R.card,
            paddingVertical: 13,
            paddingHorizontal: 15,
            marginTop: 8,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <CheckIcon size={16} />
          <Txt f="sansSemi" size={14} color={C.white}>
            {L.readyPickup}
          </Txt>
        </Pressable>

        {/* ── customer ── */}
        <Card
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            padding: 14,
            marginTop: 12,
          }}
        >
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: R.tileLg,
              backgroundColor: C.ink,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Mono size={14} color={C.white}>
              {order.initials}
            </Mono>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt f="sansSemi" size={16}>
              {order.customerName}
            </Txt>
            <Mono f="monoMedium" size={13} color={C.ink50} style={{ marginTop: 2 }}>
              {order.phone}
            </Mono>
          </View>
          <Txt
            size={12}
            color={C.ink45}
            align={ar ? 'left' : 'right'}
            style={{ maxWidth: 110 }}
            numberOfLines={3}
          >
            {order.address}
          </Txt>
        </Card>

        {/* ── stats ── */}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
          <StatTile
            label={L.rank}
            value={order.rank === null ? '—' : `${order.rank}%`}
            color={rankColor(order.rank)}
          />
          <StatTile
            label={L.clarity}
            value={order.clarity === null ? '—' : `${order.clarity}%`}
            color={clarityColor(order.clarity)}
          />
          <StatTile label={L.shipping} value={money(order.shipping)} color={C.ink} />
        </View>

        {/* ── actions ── */}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          <ActionTile
            label={L.call}
            icon={<PhoneIcon />}
            bg={C.greenDeep}
            fg={C.white}
            onPress={() => {
              setContactTarget('customer');
              openSheet('call');
            }}
          />
          <ActionTile
            label={L.wa}
            icon={<WhatsAppIcon />}
            bg={C.ink}
            fg={C.white}
            onPress={() => {
              setContactTarget('customer');
              openSheet('wa');
            }}
          />
          <ActionTile
            label={L.photo}
            icon={<CameraIcon />}
            bg={C.surface}
            fg={C.ink}
            bordered
            onPress={() => openSheet('photo')}
          />
          <ActionTile
            label={L.edit}
            icon={<EditIcon />}
            bg={C.surface}
            fg={C.ink}
            bordered
            opacity={editable ? 1 : 0.4}
            onPress={() => {
              if (!editable) {
                showToast(L.qtyLocked);
                return;
              }
              resetDraft();
              go('edit');
            }}
          />
        </View>

        {/* ── contact history ── */}
        <View style={{ marginTop: 16 }}>
          <Txt f="sansSemi" size={13} color={C.ink50} style={{ marginHorizontal: 2, marginBottom: 8 }}>
            {L.history}
          </Txt>
          <View style={{ gap: 7 }}>
            {history.length === 0 ? (
              <EmptyState text={L.noHistory} />
            ) : (
              history.slice(0, 6).map((h) => <HistoryRow key={h.id} entry={h} />)
            )}
          </View>
        </View>

        {/* ── contents ── */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            marginTop: 22,
            marginBottom: 10,
            marginHorizontal: 2,
          }}
        >
          <Txt f="sansSemi" size={15}>
            {L.contents}
          </Txt>
          <Mono f="monoMedium" size={13} color={C.ink40}>
            {order.itemCount} {L.items}
          </Mono>
        </View>

        <View style={{ gap: 8 }}>
          {order.items.map((it) => (
            <Card
              key={it.lineItemId}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 11 }}
            >
              <Thumb uri={it.image} size={46} radius={11} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt f="sansSemi" size={14} numberOfLines={2}>
                  {it.title}
                </Txt>
                <Mono f="monoMedium" size={12} color={C.ink42} style={{ marginTop: 2 }}>
                  {it.sku || `${money(it.unitPrice)} EGP`}
                </Mono>
              </View>
              <View
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: R.tile,
                  backgroundColor: C.surfaceMuted,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Mono size={16}>{it.quantity}</Mono>
              </View>
              <Mono size={14} style={{ minWidth: 54, textAlign: ar ? 'left' : 'right' }}>
                {money(it.unitPrice * it.quantity)}
              </Mono>
            </Card>
          ))}
        </View>

        {/* ── delivery address ── */}
        <View style={{ marginTop: 16 }}>
          <Txt f="sansSemi" size={13} color={C.ink50} style={{ marginBottom: 7 }}>
            {L.deliverTo}
          </Txt>
          <Card style={{ paddingVertical: 13, paddingHorizontal: 14, borderRadius: R.card }}>
            <Txt size={14} lh={21}>
              {order.address}
            </Txt>
          </Card>
        </View>

        {/* ── totals ── */}
        <Card style={{ marginTop: 12, paddingVertical: 14, paddingHorizontal: 16 }}>
          <Row label={L.subtotal} value={money(order.subtotal)} />
          <Row label={L.shipping} value={money(order.shipping)} />
          <Divider style={{ marginVertical: 11 }} />
          <View
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}
          >
            <Txt f="sansSemi" size={14}>
              {L.cod}
            </Txt>
            <Mono size={24} ls={-0.5}>
              {money(order.cod)}
            </Mono>
          </View>
        </Card>

        {/* ── attached photos ── */}
        {photos.length > 0 ? (
          <View style={{ marginTop: 18 }}>
            <Txt f="sansSemi" size={14} style={{ marginHorizontal: 2, marginBottom: 9 }}>
              {L.attached} · {photos.length}
            </Txt>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {photos.map((p) => (
                <Image
                  key={p.url}
                  source={{ uri: p.url }}
                  style={{
                    width: 78,
                    height: 78,
                    borderRadius: R.tileLg,
                    backgroundColor: C.surfaceImage,
                  }}
                  contentFit="cover"
                />
              ))}
            </ScrollView>
          </View>
        ) : null}
      </ScrollView>

      {/* ── sticky CTA ── */}
      <View
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          paddingTop: 12,
          paddingHorizontal: GUTTER,
          paddingBottom: 22,
          backgroundColor: C.bg,
        }}
      >
        <PrimaryButton
          label={L.markReady}
          onPress={() => void markReady(order)}
          loading={busy !== null}
        />
      </View>
    </View>
  );
}

function StatTile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <Card style={{ flex: 1, paddingVertical: 11, paddingHorizontal: 13, borderRadius: R.card }}>
      <Txt f="sansMedium" size={10.5} color={C.ink42} ls={0.42}>
        {label}
      </Txt>
      <Mono size={20} color={color} style={{ marginTop: 3 }}>
        {value}
      </Mono>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
      <Txt size={13} color={C.ink50}>
        {label}
      </Txt>
      <Mono f="mono" size={13} color={C.ink50}>
        {value}
      </Mono>
    </View>
  );
}

export function HistoryRow({
  entry,
}: {
  entry: { id: string; kind: string; text: string; at: string; durationSec?: number };
}) {
  const isCall = entry.kind === 'call';
  const time = new Date(entry.at).toLocaleString('en-GB', {
    timeZone: 'Africa/Cairo',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const dur =
    entry.durationSec !== undefined
      ? `${String(Math.floor(entry.durationSec / 60)).padStart(2, '0')}:${String(
          Math.floor(entry.durationSec % 60),
        ).padStart(2, '0')}`
      : '';

  return (
    <Card
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 11,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: R.tileLg,
      }}
    >
      <View
        style={{
          width: 30,
          height: 30,
          borderRadius: 9,
          backgroundColor: isCall ? C.greenDeep : C.ink,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {isCall ? <PhoneIcon size={15} /> : <WhatsAppIcon size={15} />}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt f="sansMedium" size={13} numberOfLines={2}>
          {entry.text}
        </Txt>
        <Mono f="mono" size={11} color={C.ink40} style={{ marginTop: 2 }}>
          {time}
        </Mono>
      </View>
      {dur ? (
        <Mono f="monoMedium" size={12} color={C.ink40}>
          {dur}
        </Mono>
      ) : null}
    </Card>
  );
}
