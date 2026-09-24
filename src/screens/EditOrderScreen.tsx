import React from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BackButton, Card, Mono, PrimaryButton, Thumb, Txt } from '../components/primitives';
import { money, type Order } from '../api/model';
import { useApp } from '../state/AppState';
import { C, F, GUTTER, R } from '../theme/tokens';

/**
 * Quantity and address edits. Committing runs a real Shopify order edit
 * (which Shopify records on the order timeline) and re-syncs the courier's COD.
 */
export function EditOrderScreen({ order }: { order: Order }) {
  const { L, ar, go, draft, setQty, addProduct, setDraftAddress, draftTotals, saveEdit, catalog, busy, showToast } =
    useApp();

  const insets = useSafeAreaInsets();
  const totals = draftTotals(order);
  const locked = order.locked;
  const address = draft.address ?? order.address;

  const guard = (fn: () => void) => () => {
    if (locked) {
      showToast(L.qtyLocked);
      return;
    }
    fn();
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, minHeight: 0 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
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
          {L.editOrder}
        </Txt>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: 24, gap: 9 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        {/* Address first: at the bottom the keyboard covered it. */}
        <View style={{ marginBottom: 9 }}>
          <Txt f="sansSemi" size={13} color={C.ink45} style={{ marginBottom: 7 }}>
            {L.deliverTo}
          </Txt>
          <TextInput
            value={address}
            onChangeText={setDraftAddress}
            editable={!locked}
            multiline
            textAlign={ar ? 'right' : 'left'}
            style={{
              minHeight: 64,
              backgroundColor: C.surface,
              borderWidth: 1,
              borderColor: C.borderInput,
              borderRadius: R.card,
              paddingVertical: 12,
              paddingHorizontal: 13,
              fontFamily: F.sans,
              fontSize: 14,
              lineHeight: 21,
              color: C.ink,
              textAlignVertical: 'top',
              opacity: locked ? 0.5 : 1,
            }}
          />
        </View>
        {order.items.map((it) => {
          const qty = draft.quantities[it.lineItemId] ?? it.quantity;
          return (
            <Card
              key={it.lineItemId}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12 }}
            >
              <Thumb uri={it.image} size={44} radius={11} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt f="sansSemi" size={14} numberOfLines={2}>
                  {it.title}
                </Txt>
                <Mono f="monoMedium" size={12} color={C.ink42} style={{ marginTop: 2 }}>
                  {money(it.unitPrice)}
                </Mono>
              </View>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  backgroundColor: C.surfaceMuted,
                  borderRadius: R.tileLg,
                  padding: 4,
                  opacity: locked ? 0.45 : 1,
                }}
              >
                <Pressable
                  onPress={guard(() => setQty(it.lineItemId, Math.max(0, qty - 1)))}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: R.pill,
                    backgroundColor: C.white,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Mono size={20}>−</Mono>
                </Pressable>
                <View style={{ width: 34, alignItems: 'center' }}>
                  <Mono size={17}>{qty}</Mono>
                </View>
                <Pressable
                  onPress={guard(() => setQty(it.lineItemId, qty + 1))}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: R.pill,
                    backgroundColor: C.ink,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Mono size={20} color={C.white}>
                    +
                  </Mono>
                </Pressable>
              </View>
            </Card>
          );
        })}

        {/* queued additions */}
        {draft.additions.map((add, i) => (
          <Card
            key={`${add.variantId}-${i}`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 11,
              padding: 12,
              borderColor: C.green,
            }}
          >
            <Thumb uri={add.image} size={44} radius={11} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt f="sansSemi" size={14} numberOfLines={2}>
                {add.title}
              </Txt>
              <Mono f="monoMedium" size={12} color={C.greenDeep} style={{ marginTop: 2 }}>
                + {money(add.price)}
              </Mono>
            </View>
            <Mono size={17}>1</Mono>
          </Card>
        ))}

        <Txt
          f="sansSemi"
          size={13}
          color={C.ink45}
          style={{ marginTop: 16, marginBottom: 4, marginHorizontal: 2 }}
        >
          {L.addProduct}
        </Txt>

        {catalog.map((c) => (
          <Card
            key={c.variantId}
            dashed
            onPress={guard(() => addProduct(c))}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12 }}
          >
            <Thumb uri={c.image} size={44} radius={11} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt f="sansSemi" size={14} numberOfLines={2}>
                {c.title}
              </Txt>
              <Mono f="monoMedium" size={12} color={C.ink42} style={{ marginTop: 2 }}>
                {money(parseFloat(c.price))}
                {c.available !== null ? ` · ${c.available} in stock` : ''}
              </Mono>
            </View>
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: R.tile,
                backgroundColor: C.green,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Mono size={20} color={C.white}>
                +
              </Mono>
            </View>
          </Card>
        ))}

      </ScrollView>

      {/* In the layout flow, not floating, so the keyboard pushes it up. */}
      <View
        style={{
          paddingTop: 12,
          paddingHorizontal: GUTTER,
          paddingBottom: 12 + insets.bottom,
          backgroundColor: C.bg,
          borderTopWidth: 1,
          borderTopColor: C.border,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <View style={{ flex: 1 }}>
          <Txt size={11} color={C.ink45}>
            {L.cod}
          </Txt>
          <Mono size={24} ls={-0.5}>
            {money(totals.cod)}
          </Mono>
        </View>
        <PrimaryButton
          label={L.save}
          onPress={() => void saveEdit(order)}
          color={C.ink}
          loading={busy !== null}
          style={{ paddingHorizontal: 30 }}
        />
      </View>
    </KeyboardAvoidingView>
  );
}
