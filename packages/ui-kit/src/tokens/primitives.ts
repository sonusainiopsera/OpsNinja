export const gray = {
  '50': '#f9fafb',
  '100': '#f3f4f6',
  '200': '#e5e7eb',
  '300': '#d1d5db',
  '400': '#9ca3af',
  '500': '#6b7280',
  '600': '#4b5563',
  '700': '#374151',
  '800': '#1f2937',
  '900': '#111827',
  '950': '#030712',
} as const;

export const indigo = {
  '50': '#eef2ff',
  '100': '#e0e7ff',
  '200': '#c7d2fe',
  '300': '#a5b4fc',
  '400': '#818cf8',
  '500': '#6366f1',
  '600': '#4f46e5',
  '700': '#4338ca',
  '800': '#3730a3',
  '900': '#312e81',
  '950': '#1e1b4b',
} as const;

export const red = {
  '400': '#f87171',
  '500': '#ef4444',
  '600': '#dc2626',
  '700': '#b91c1c',
} as const;

export const amber = {
  '400': '#fbbf24',
  '500': '#f59e0b',
  '600': '#d97706',
  '700': '#b45309',
} as const;

export const green = {
  '400': '#4ade80',
  '500': '#22c55e',
  '600': '#16a34a',
  '700': '#15803d',
} as const;

export const blue = {
  '400': '#60a5fa',
  '500': '#3b82f6',
  '600': '#2563eb',
  '700': '#1d4ed8',
} as const;

export const white = '#ffffff' as const;

export const spacing = {
  '1': '4px',
  '2': '8px',
  '3': '12px',
  '4': '16px',
  '5': '20px',
  '6': '24px',
  '7': '28px',
  '8': '32px',
  '9': '36px',
  '10': '40px',
  '11': '44px',
  '12': '48px',
  '14': '56px',
  '16': '64px',
  '20': '80px',
  '24': '96px',
} as const;

export const radius = {
  none: '0',
  sm: '2px',
  md: '4px',
  lg: '8px',
  xl: '12px',
  '2xl': '16px',
  full: '9999px',
} as const;

export const elevation = {
  sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  md: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
  lg: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  xl: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
} as const;

export type GrayScale = keyof typeof gray;
export type IndigoScale = keyof typeof indigo;
export type SpacingStep = keyof typeof spacing;
export type RadiusStep = keyof typeof radius;
export type ElevationStep = keyof typeof elevation;
