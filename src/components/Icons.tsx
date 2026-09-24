import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { C } from '../theme/tokens';

/** Icon paths are copied verbatim from the mockup's inline SVG. */

type IconProps = { size?: number; color?: string };

export const PhoneIcon = ({ size = 22, color = C.white }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 22 22" fill="none">
    <Path
      d="M6 3h3l2 4-2.5 2c1 2.5 2.5 4 5 5L15 11l4 2v3c0 1.7-1.3 3-3 3C9.8 19 3 12.2 3 6c0-1.7 1.3-3 3-3Z"
      fill={color}
    />
  </Svg>
);

export const WhatsAppIcon = ({ size = 22, color = C.white }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 22 22" fill="none">
    <Circle cx={11} cy={10} r={8} fill={color} />
    <Path d="M5 20l2.5-4h4L5 20Z" fill={color} />
  </Svg>
);

export const CameraIcon = ({ size = 22, color = C.ink }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 22 22" fill="none">
    <Rect x={1.5} y={5.5} width={19} height={14} rx={3} stroke={color} strokeWidth={1.8} />
    <Circle cx={11} cy={12.5} r={3.6} stroke={color} strokeWidth={1.8} />
    <Rect x={7.5} y={2.5} width={7} height={3} rx={1.2} fill={color} />
  </Svg>
);

export const EditIcon = ({ size = 22, color = C.ink }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 22 22" fill="none">
    <Path d="M4 18h4L19 7l-4-4L4 14v4Z" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
  </Svg>
);

export const CheckIcon = ({ size = 16, color = C.white }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 22 22" fill="none">
    <Path
      d="M4 11.5 9 16 18 6"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const CheckSmallIcon = ({ size = 16, color = C.white }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
    <Path
      d="M3 8.5 6.5 12 13 4.5"
      stroke={color}
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export const CancelIcon = ({ size = 16, color = C.white }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 22 22" fill="none">
    <Circle cx={11} cy={11} r={8.5} stroke={color} strokeWidth={1.8} />
    <Path d="M6.5 15.5 15.5 6.5" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
  </Svg>
);

export const SearchIcon = ({ size = 18, color = C.ink35 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 18 18" fill="none">
    <Circle cx={7.5} cy={7.5} r={5.5} stroke={color} strokeWidth={1.8} />
    <Path d="M11.5 11.5 16 16" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
  </Svg>
);

export const ScanIcon = ({ size = 30, color = C.white }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 30 30" fill="none">
    <Path
      d="M3 9V5a2 2 0 0 1 2-2h4M27 9V5a2 2 0 0 0-2-2h-4M3 21v4a2 2 0 0 0 2 2h4M27 21v4a2 2 0 0 1-2 2h-4"
      stroke={color}
      strokeWidth={2.2}
      strokeLinecap="round"
    />
    <Path d="M4 15h22" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
  </Svg>
);

export const ListIcon = ({ size = 22, color = C.ink30 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 22 22" fill="none">
    <Rect x={3} y={4} width={16} height={3} rx={1.5} fill={color} />
    <Rect x={3} y={9.5} width={16} height={3} rx={1.5} fill={color} />
    <Rect x={3} y={15} width={16} height={3} rx={1.5} fill={color} />
  </Svg>
);

export const GridIcon = ({ size = 22, color = C.ink30 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 22 22" fill="none">
    <Rect x={3} y={3} width={7} height={7} rx={2} fill={color} />
    <Rect x={12} y={3} width={7} height={7} rx={2} fill={color} />
    <Rect x={3} y={12} width={7} height={7} rx={2} fill={color} />
    <Rect x={12} y={12} width={7} height={7} rx={2} fill={color} />
  </Svg>
);

export const TruckIcon = ({ size = 26, color = C.white }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 26 26" fill="none">
    <Path d="M2 8h11v10H2V8Zm11 3h6l4 4v3h-10v-7Z" fill={color} />
    <Circle cx={7} cy={20} r={2.5} fill={color} />
    <Circle cx={18} cy={20} r={2.5} fill={color} />
  </Svg>
);

export const ClockIcon = ({ size = 26, color = C.white }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 26 26" fill="none">
    <Path
      d="M4 13c0-5 4-9 9-9s9 4 9 9-4 9-9 9"
      stroke={color}
      strokeWidth={2.2}
      strokeLinecap="round"
    />
    <Path
      d="M13 8v5l4 2"
      stroke={color}
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);
