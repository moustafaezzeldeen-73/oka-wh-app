import React from 'react';
import { ActivityIndicator, View } from 'react-native';

import { C, R } from '../theme/tokens';
import { CheckSmallIcon } from './Icons';
import { Txt } from './primitives';

/** The dark pill that drops in below the status bar after a write succeeds. */
export function Toast({ message, top }: { message: string; top: number }) {
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top,
        left: 18,
        right: 18,
        backgroundColor: C.ink,
        borderRadius: 15,
        paddingVertical: 14,
        paddingHorizontal: 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 11,
        shadowColor: '#000',
        shadowOpacity: 0.3,
        shadowRadius: 30,
        shadowOffset: { width: 0, height: 10 },
        elevation: 8,
      }}
    >
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: R.chipLg,
          backgroundColor: C.greenDeep,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <CheckSmallIcon size={14} />
      </View>
      <Txt f="sansSemi" size={14} color={C.white} style={{ flex: 1 }}>
        {message}
      </Txt>
    </View>
  );
}

/** Shown while a write to Shopify or Bosta is in flight. */
export function BusyBar({ message, top }: { message: string; top: number }) {
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top,
        left: 18,
        right: 18,
        backgroundColor: C.ink,
        borderRadius: 15,
        paddingVertical: 14,
        paddingHorizontal: 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 11,
        elevation: 8,
      }}
    >
      <ActivityIndicator size="small" color={C.green} />
      <Txt f="sansSemi" size={14} color={C.white} style={{ flex: 1 }}>
        {message}
      </Txt>
    </View>
  );
}
