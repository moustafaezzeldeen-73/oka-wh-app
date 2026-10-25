import React from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { C, CHIP, F, R, type ChipKey } from '../theme/tokens';

// ── Text ─────────────────────────────────────────────────────────────────────

type TxtProps = {
  children: React.ReactNode;
  /** Font family shorthand. */
  f?: keyof typeof F;
  size?: number;
  color?: string;
  lh?: number;
  ls?: number;
  align?: TextStyle['textAlign'];
  numberOfLines?: number;
  style?: StyleProp<TextStyle>;
};

export function Txt({
  children,
  f = 'sans',
  size = 14,
  color = C.ink,
  lh,
  ls,
  align,
  numberOfLines,
  style,
}: TxtProps) {
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[
        {
          fontFamily: F[f],
          fontSize: size,
          color,
          ...(lh ? { lineHeight: lh } : null),
          ...(ls !== undefined ? { letterSpacing: ls } : null),
          ...(align ? { textAlign: align } : null),
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/** Numerics always render LTR, even in Arabic layout. */
export function Mono(props: TxtProps) {
  return <Txt {...props} f={props.f ?? 'monoSemi'} style={[{ writingDirection: 'ltr' }, props.style]} />;
}

// ── Surfaces ─────────────────────────────────────────────────────────────────

export function Card({
  children,
  style,
  onPress,
  dashed = false,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  dashed?: boolean;
}) {
  const base: ViewStyle = {
    backgroundColor: dashed ? 'transparent' : C.surface,
    borderWidth: 1,
    borderColor: dashed ? C.borderDashed : C.border,
    borderStyle: dashed ? 'dashed' : 'solid',
    borderRadius: R.cardLg,
  };
  if (!onPress) return <View style={[base, style]}>{children}</View>;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [base, style, pressed && { opacity: 0.75 }]}
    >
      {children}
    </Pressable>
  );
}

export function Chip({ status, ar, style }: { status: ChipKey; ar: boolean; style?: StyleProp<ViewStyle> }) {
  const c = CHIP[status];
  return (
    <View
      style={[
        {
          paddingHorizontal: 8,
          paddingVertical: 3,
          borderRadius: R.chip,
          backgroundColor: c.bg,
        },
        style,
      ]}
    >
      <Txt f="sansSemi" size={11} color={c.fg}>
        {ar ? c.ar : c.en}
      </Txt>
    </View>
  );
}

/** Product / order thumbnail with the mockup's muted placeholder fill. */
export function Thumb({
  uri,
  size,
  radius,
}: {
  uri: string | null;
  size: number;
  radius: number;
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        overflow: 'hidden',
        backgroundColor: C.surfaceImage,
      }}
    >
      {uri ? (
        <Image source={{ uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
      ) : null}
    </View>
  );
}

// ── Buttons ──────────────────────────────────────────────────────────────────

export function PrimaryButton({
  label,
  onPress,
  color = C.green,
  textColor = C.white,
  height = 60,
  disabled = false,
  loading = false,
  style,
  icon,
}: {
  label: string;
  onPress: () => void;
  color?: string;
  textColor?: string;
  height?: number;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  icon?: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={disabled || loading ? undefined : onPress}
      style={({ pressed }) => [
        {
          height,
          borderRadius: R.button,
          backgroundColor: color,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: 10,
          opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={textColor} /> : icon}
      <Txt f="sansMedium" size={17} color={textColor}>
        {label}
      </Txt>
    </Pressable>
  );
}

/** The four square action tiles under the order stats. */
export function ActionTile({
  label,
  icon,
  onPress,
  bg,
  fg,
  bordered = false,
  opacity = 1,
}: {
  label: string;
  icon: React.ReactNode;
  onPress: () => void;
  bg: string;
  fg: string;
  bordered?: boolean;
  opacity?: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        backgroundColor: bg,
        borderRadius: R.cardLg,
        paddingVertical: 13,
        paddingHorizontal: 6,
        alignItems: 'center',
        gap: 7,
        borderWidth: bordered ? 1 : 0,
        borderColor: 'rgba(0,0,0,0.1)',
        opacity: pressed ? 0.8 : opacity,
      })}
    >
      {icon}
      <Txt f="sansSemi" size={12} color={fg}>
        {label}
      </Txt>
    </Pressable>
  );
}

/** Circular back chevron; the glyph flips with layout direction. */
export function BackButton({ onPress, ar }: { onPress: () => void; ar: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({
        width: 38,
        height: 38,
        borderRadius: 12,
        backgroundColor: C.ink06,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Mono size={16} color={C.ink}>
        {ar ? '→' : '←'}
      </Mono>
    </Pressable>
  );
}

// ── Misc ─────────────────────────────────────────────────────────────────────

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[{ height: 1, backgroundColor: C.border }, style]} />;
}

export function EmptyState({ text }: { text: string }) {
  return (
    <View
      style={{
        backgroundColor: C.surface,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: C.borderDashed,
        borderRadius: R.tileLg,
        padding: 16,
        alignItems: 'center',
      }}
    >
      <Txt f="sansMedium" size={13} color={C.ink40} align="center">
        {text}
      </Txt>
    </View>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, minHeight: 0 },
  row: { flexDirection: 'row', alignItems: 'center' },
});
