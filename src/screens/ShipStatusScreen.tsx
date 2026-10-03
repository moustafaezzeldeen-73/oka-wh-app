import React, { useMemo } from 'react';
import { ScrollView, TextInput, View } from 'react-native';

import { BackButton, Card, EmptyState, Mono, Txt } from '../components/primitives';
import { searchByPhone } from '../api/repository';
import { useApp } from '../state/AppState';
import { C, F, GUTTER, R } from '../theme/tokens';

/** Look a shipment up by the customer's phone number. */
export function ShipStatusScreen() {
  const { L, ar, go, orders, shipQuery, setShipQuery, select } = useApp();

  const results = useMemo(() => searchByPhone(orders, shipQuery), [orders, shipQuery]);
  const empty = shipQuery.trim().length > 0 && results.length === 0;

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
        <BackButton onPress={() => go('modes')} ar={ar} />
        <Txt f="sansSemi" size={19}>
          {L.shipStatus}
        </Txt>
      </View>

      <View style={{ paddingHorizontal: GUTTER, paddingBottom: 12 }}>
        <TextInput
          value={shipQuery}
          onChangeText={setShipQuery}
          placeholder={L.searchPhone}
          placeholderTextColor={C.ink38}
          keyboardType="phone-pad"
          style={{
            height: 50,
            borderRadius: R.card,
            borderWidth: 1,
            borderColor: C.borderInput,
            backgroundColor: C.surface,
            paddingHorizontal: 16,
            fontFamily: F.monoMedium,
            fontSize: 15,
            color: C.ink,
            textAlign: 'left',
          }}
        />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: 40, gap: 8 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {empty ? <EmptyState text={L.noResults} /> : null}

        {results.map((o) => (
          <Card
            key={o.shopifyId}
            onPress={() => {
              select(o.shopifyId);
              go('shipdetail');
            }}
            style={{ paddingVertical: 13, paddingHorizontal: 15, borderRadius: R.card }}
          >
            <View
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
            >
              <Txt f="sansSemi" size={15} numberOfLines={1} style={{ flex: 1 }}>
                {o.customerName}
              </Txt>
              <Mono f="monoMedium" size={12} color={C.ink40}>
                {o.awb ?? o.name}
              </Mono>
            </View>
            <Mono f="monoMedium" size={13} color={C.ink50} style={{ marginTop: 3 }}>
              {o.phone}
            </Mono>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 9 }}>
              <View
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: R.chipLg,
                  backgroundColor: '#E8F3EC',
                }}
              >
                <Txt f="sansSemi" size={12} color={C.greenDeep}>
                  {ar ? o.trackPhaseLabel.ar : o.trackPhaseLabel.en}
                </Txt>
              </View>
              {o.courier ? (
                <Txt f="sansMedium" size={12} color={C.ink50} numberOfLines={1}>
                  {o.courier.name}
                </Txt>
              ) : (
                <Txt size={12} color={C.ink35}>
                  {L.notAssigned}
                </Txt>
              )}
            </View>
          </Card>
        ))}
      </ScrollView>
    </View>
  );
}
