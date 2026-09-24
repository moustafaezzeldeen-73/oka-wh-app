import React from 'react';
import { Pressable, View } from 'react-native';

import { useApp } from '../state/AppState';
import { C } from '../theme/tokens';
import { GridIcon, ListIcon, ScanIcon } from './Icons';
import { Txt } from './primitives';

/**
 * Bottom tab bar: orders · scan (raised) · modes.
 * Height 84 with a 14px bottom inset, matching the mockup.
 */
export function TabBar({ bottomInset }: { bottomInset: number }) {
  const { screen, go, L } = useApp();

  const listColor = screen === 'list' ? C.ink : C.ink30;
  const modesColor = screen === 'modes' ? C.ink : C.ink30;

  return (
    <View
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: 84 + bottomInset,
        backgroundColor: 'rgba(243,245,244,0.94)',
        borderTopWidth: 1,
        borderTopColor: C.border,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
        paddingBottom: 14 + bottomInset,
      }}
    >
      <Pressable
        onPress={() => go('list')}
        style={{ flex: 1, alignItems: 'center', gap: 5, paddingTop: 12 }}
      >
        <ListIcon color={listColor} />
        <Txt f="sansSemi" size={11} color={listColor}>
          {L.orders}
        </Txt>
      </Pressable>

      <View style={{ width: 74, alignItems: 'center' }}>
        <Pressable
          onPress={() => go('scan')}
          style={({ pressed }) => ({
            width: 64,
            height: 64,
            borderRadius: 22,
            backgroundColor: C.green,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 14,
            shadowColor: C.green,
            shadowOpacity: 0.28,
            shadowRadius: 20,
            shadowOffset: { width: 0, height: 8 },
            elevation: 6,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <ScanIcon />
        </Pressable>
      </View>

      <Pressable
        onPress={() => go('modes')}
        style={{ flex: 1, alignItems: 'center', gap: 5, paddingTop: 12 }}
      >
        <GridIcon color={modesColor} />
        <Txt f="sansSemi" size={11} color={modesColor}>
          {L.modes}
        </Txt>
      </Pressable>
    </View>
  );
}
