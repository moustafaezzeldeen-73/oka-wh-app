import React, { useMemo } from 'react';
import { View } from 'react-native';

/**
 * The mockup's barcode motif: 28 bars, widths drawn from {1,2,3,4}, 2px gutters.
 *
 * Widths are derived from the AWB digits rather than hard-coded, so each
 * shipment gets its own stable pattern — the same order always renders the
 * same barcode, and two orders never look identical.
 */

const BAR_COUNT = 28;
const WIDTHS = [3, 1, 2, 1, 4, 1, 1, 2, 3, 1, 2, 4, 1, 1, 3, 2, 1, 4, 1, 2, 1, 3, 1, 2, 4, 1, 1, 2];

function barsFor(seed: string | null): number[] {
  if (!seed) return WIDTHS;
  const digits = seed.replace(/\D/g, '');
  if (digits.length === 0) return WIDTHS;

  const out: number[] = [];
  for (let i = 0; i < BAR_COUNT; i++) {
    const d = Number(digits[i % digits.length]);
    // Map 0–9 onto the mockup's {1,2,3,4} width vocabulary, offset per position
    // so repeating digits still produce a varied pattern.
    out.push(((d + i) % 4) + 1);
  }
  return out;
}

export function Barcode({
  value,
  height,
  color,
}: {
  value: string | null;
  height: number;
  color: string;
}) {
  const bars = useMemo(() => barsFor(value), [value]);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', height, gap: 2 }}>
      {bars.map((w, i) => (
        <View key={i} style={{ width: w, height, backgroundColor: color }} />
      ))}
    </View>
  );
}
