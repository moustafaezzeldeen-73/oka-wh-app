import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { ChartIcon, ClockIcon, TruckIcon } from '../components/Icons';
import { Card, Mono, Txt } from '../components/primitives';
import { useApp } from '../state/AppState';
import { C, CHIP, GUTTER, R } from '../theme/tokens';

export function ModesScreen() {
  const { L, go, scanned, orders } = useApp();

  return (
    // Scrolls: three mode cards plus the shift summary overflow a small phone.
    <ScrollView
      style={{ flex: 1, minHeight: 0 }}
      contentContainerStyle={{ paddingTop: 8, paddingHorizontal: GUTTER, paddingBottom: 110 }}
      showsVerticalScrollIndicator={false}
    >
      <Txt f="sansSemi" size={22} style={{ marginBottom: 6 }}>
        {L.modes}
      </Txt>
      <Txt size={14} lh={21} color={C.ink45} style={{ marginBottom: 18 }}>
        {L.modesHint}
      </Txt>

      <ModeCard
        bg={C.greenDeep}
        icon={<TruckIcon />}
        title={L.pickup}
        hint={L.pickupHint}
        hintColor={C.onDark72}
        onPress={() => go('pickup')}
      />

      <ModeCard
        bg={C.ink}
        icon={<ClockIcon />}
        title={L.shipStatus}
        hint={L.shipStatusHint}
        hintColor={C.onDark60}
        onPress={() => go('shipstatus')}
      />

      <ModeCard
        bg={CHIP.new.fg}
        icon={<ChartIcon />}
        title={L.report}
        hint={L.reportHint}
        hintColor={C.onDark72}
        onPress={() => go('report')}
      />

      <Card style={{ marginTop: 22, padding: 16, borderRadius: R.panel }}>
        <Txt f="sansSemi" size={14} style={{ marginBottom: 12 }}>
          {L.shift}
        </Txt>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Mono size={26} color={C.greenDeep}>
              {scanned.length}
            </Mono>
            <Txt size={11} color={C.ink45} style={{ marginTop: 2 }}>
              {L.loaded}
            </Txt>
          </View>
          <View style={{ flex: 1 }}>
            <Mono size={26}>{orders.length}</Mono>
            <Txt size={11} color={C.ink45} style={{ marginTop: 2 }}>
              {L.open}
            </Txt>
          </View>
        </View>
      </Card>
    </ScrollView>
  );
}

function ModeCard({
  bg,
  icon,
  title,
  hint,
  hintColor,
  onPress,
}: {
  bg: string;
  icon: React.ReactNode;
  title: string;
  hint: string;
  hintColor: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: bg,
        borderRadius: 22,
        padding: 22,
        marginBottom: 12,
        opacity: pressed ? 0.88 : 1,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        {icon}
        <Txt f="sansSemi" size={21} color={C.white}>
          {title}
        </Txt>
      </View>
      <Txt size={14} lh={21} color={hintColor}>
        {hint}
      </Txt>
    </Pressable>
  );
}
