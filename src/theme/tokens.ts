/**
 * Design tokens lifted verbatim from the OKA Warehouse mockup.
 * Every literal here appears in the source HTML — do not "tidy" the values.
 */

export const C = {
  /** Page background inside the phone frame. */
  bg: '#F3F5F4',
  /** Primary ink / near-black brand colour. */
  ink: '#1C2321',
  /** Brand green used for the primary CTA and scan button. */
  green: '#0F9D58',
  /** Deeper green for call buttons, pickup mode and success dots. */
  greenDeep: '#0B7C46',
  /** Flash green used while a scan registers. */
  greenFlash: '#2FBF77',
  red: '#A63A3A',
  amber: '#8A6520',
  white: '#FFFFFF',
  /** Card and tile fills. */
  surface: '#FFFFFF',
  surfaceMuted: '#EDF0EF',
  surfaceImage: '#EFF2F1',
  /** Full-bleed dark surfaces (scanner, call screen). */
  dark: '#1C2321',
  darkCamera: '#141917',
  scanLine: '#3B82F6',
  recordDot: '#FF5A5A',
  recordText: '#FF9A9A',

  border: 'rgba(0,0,0,0.08)',
  borderStrong: 'rgba(0,0,0,0.09)',
  borderInput: 'rgba(0,0,0,0.12)',
  borderDashed: 'rgba(0,0,0,0.18)',
  borderTrackDot: 'rgba(0,0,0,0.22)',

  ink70: 'rgba(0,0,0,0.7)',
  ink60: 'rgba(0,0,0,0.6)',
  ink55: 'rgba(0,0,0,0.55)',
  ink50: 'rgba(0,0,0,0.5)',
  ink45: 'rgba(0,0,0,0.45)',
  ink42: 'rgba(0,0,0,0.42)',
  ink40: 'rgba(0,0,0,0.4)',
  ink38: 'rgba(0,0,0,0.38)',
  ink35: 'rgba(0,0,0,0.35)',
  ink30: 'rgba(0,0,0,0.3)',
  ink06: 'rgba(0,0,0,0.06)',

  onDark75: 'rgba(255,255,255,0.75)',
  onDark72: 'rgba(255,255,255,0.72)',
  onDark70: 'rgba(255,255,255,0.7)',
  onDark60: 'rgba(255,255,255,0.6)',
  onDark55: 'rgba(255,255,255,0.55)',
  onDark50: 'rgba(255,255,255,0.5)',
  onDark35: 'rgba(255,255,255,0.35)',
  onDark28: 'rgba(255,255,255,0.28)',
  onDark25: 'rgba(255,255,255,0.25)',
  onDark16: 'rgba(255,255,255,0.16)',
  onDark12: 'rgba(255,255,255,0.12)',
  onDark10: 'rgba(255,255,255,0.1)',
  onDark06: 'rgba(255,255,255,0.06)',
} as const;

/** Status chip palette — keys match the order status vocabulary. */
export const CHIP = {
  new: { bg: '#ECF1F2', fg: '#3F6470', ar: 'جديد', en: 'New' },
  badaddr: { bg: '#F6EFE4', fg: '#8A6520', ar: 'عنوان ناقص', en: 'Bad address' },
  ready: { bg: '#E8F3EC', fg: '#0B7C46', ar: 'جاهز', en: 'Ready' },
  picked: { bg: '#1C2321', fg: '#FFFFFF', ar: 'محمّل', en: 'Picked' },
  transit: { bg: '#F6EFE4', fg: '#8A6520', ar: 'في الطريق', en: 'Transit' },
  delivered: { bg: '#E8F3EC', fg: '#0B7C46', ar: 'تم التسليم', en: 'Delivered' },
  cancelled: { bg: '#F7EBEB', fg: '#A63A3A', ar: 'ملغي', en: 'Cancelled' },
} as const;

export type ChipKey = keyof typeof CHIP;

/** Font families registered by `useAppFonts`. */
export const F = {
  /** IBM Plex Sans Arabic — all UI copy, Arabic and Latin alike. */
  sans: 'PlexAr_400Regular',
  sansMedium: 'PlexAr_500Medium',
  sansSemi: 'PlexAr_600SemiBold',
  sansBold: 'PlexAr_700Bold',
  /** IBM Plex Mono — numerics: AWBs, money, timestamps, counters. */
  mono: 'PlexMono_400Regular',
  monoMedium: 'PlexMono_500Medium',
  monoSemi: 'PlexMono_600SemiBold',
} as const;

export const R = {
  chip: 6,
  chipLg: 8,
  pill: 10,
  tile: 11,
  tileLg: 13,
  card: 14,
  cardLg: 16,
  panel: 18,
  button: 18,
  sheet: 26,
  circle: 999,
} as const;

/** Horizontal gutter used by every screen body in the mockup. */
export const GUTTER = 18;

/** Rank / clarity score → colour, per the mockup's thresholds. */
export function rankColor(rank: number | null): string {
  if (rank === null) return C.ink40;
  if (rank >= 80) return C.greenDeep;
  if (rank >= 50) return C.amber;
  return C.red;
}

export function clarityColor(clarity: number | null): string {
  if (clarity === null) return C.ink40;
  if (clarity >= 70) return C.greenDeep;
  if (clarity >= 40) return C.amber;
  return C.red;
}
