import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Mono, PrimaryButton, Txt } from '../components/primitives';
import { money, type Order } from '../api/model';
import { useApp } from '../state/AppState';
import { C, F, R } from '../theme/tokens';

/**
 * Finish an in-house delivery: what the delivery cost (saved to the order's
 * In-house delivery cost field), and — only when ticked — record the cash the
 * courier handed in as paid in Shopify.
 */
export function DeliverSheet({ order }: { order: Order }) {
  const { L, openSheet, markDelivered, busy, showToast } = useApp();
  const insets = useSafeAreaInsets();
  const [costText, setCostText] = useState('');
  const [cash, setCash] = useState(false);

  // Accept Arabic-Indic digits and a comma decimal, as typed on Arabic keyboards.
  const normalised = costText
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[٫,]/g, '.')
    .trim();
  const cost = normalised === '' ? NaN : Number(normalised);
  const valid = Number.isFinite(cost) && cost >= 0;
  const owed = order.cod > 0;

  const confirm = async () => {
    if (!valid) {
      showToast(L.costRequired);
      return;
    }
    const ok = await markDelivered(order, { cost, cashCollected: owed && cash });
    if (ok) openSheet(null);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: 'rgba(0,0,0,0.4)',
        justifyContent: 'flex-end',
      }}
    >
      <Pressable style={{ flex: 1 }} onPress={() => openSheet(null)} />

      <View
        style={{
          backgroundColor: C.bg,
          borderTopLeftRadius: R.sheet,
          borderTopRightRadius: R.sheet,
          paddingTop: 18,
          paddingHorizontal: 18,
          paddingBottom: 18 + insets.bottom,
          gap: 14,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Txt f="sansSemi" size={18}>
            {L.markDelivered}
          </Txt>
          <Mono f="monoMedium" size={13} color={C.ink45}>
            {order.name}
          </Mono>
        </View>

        <Txt size={13} color={C.ink55} numberOfLines={2}>
          {order.customerName} · {order.city}
        </Txt>

        <View>
          <Txt f="sansSemi" size={13} color={C.ink45} style={{ marginBottom: 7 }}>
            {L.deliveryCostLabel}
          </Txt>
          <TextInput
            value={costText}
            onChangeText={setCostText}
            keyboardType="decimal-pad"
            autoFocus
            placeholder="0"
            placeholderTextColor={C.ink30}
            style={{
              height: 54,
              borderRadius: R.card,
              borderWidth: 1,
              borderColor: costText && !valid ? C.red : C.borderInput,
              backgroundColor: C.surface,
              paddingHorizontal: 16,
              fontFamily: F.monoMedium,
              fontSize: 22,
              color: C.ink,
              textAlign: 'left',
            }}
          />
        </View>

        {owed ? (
          <Pressable
            onPress={() => setCash((c) => !c)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
          >
            <View
              style={{
                width: 42,
                height: 26,
                borderRadius: 13,
                padding: 3,
                backgroundColor: cash ? C.green : C.ink06,
                flexDirection: 'row',
                justifyContent: cash ? 'flex-end' : 'flex-start',
              }}
            >
              <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: C.white }} />
            </View>
            <Txt size={13} color={C.ink} style={{ flex: 1 }}>
              {L.cashCollected.replace('{cod}', money(order.cod))}
            </Txt>
          </Pressable>
        ) : null}

        <PrimaryButton
          label={L.confirmDelivered}
          onPress={() => void confirm()}
          color={valid ? C.greenDeep : C.ink30}
          loading={busy !== null}
        />
      </View>
    </KeyboardAvoidingView>
  );
}
