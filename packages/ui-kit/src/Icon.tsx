import React from 'react';
import type { SlaStateMeta } from './slaStateMeta';

type IconName = SlaStateMeta['iconName'] | 'chevron-up' | 'chevron-down' | 'external-link' |
  'loader' | 'check-circle' | 'x-circle' | 'refresh-cw' | 'alert-triangle' | 'building';

interface IconProps {
  name: IconName;
  size?: number;
  'aria-hidden'?: boolean;
  className?: string;
}

const PATHS: Record<IconName, string> = {
  clock: 'M12 2a10 10 0 1 1 0 20A10 10 0 0 1 12 2zm0 2a8 8 0 1 0 0 16A8 8 0 0 0 12 4zm0 2v6l4 2-1 1.7L11 14V8h1z',
  'clock-warning': 'M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2zm0 2a8 8 0 1 1 0 16A8 8 0 0 1 12 4zm-1 4h2v5h-2zm0 6h2v2h-2z',
  'pause-circle': 'M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2zm-1 6h2v8h-2zM11 8h-2v8h2z',
  'alert-circle': 'M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2zm-1 5h2v6h-2zm0 7h2v2h-2z',
  'chevron-up': 'M18 15l-6-6-6 6',
  'chevron-down': 'M6 9l6 6 6-6',
  'external-link': 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6m4-3h6v6m-11 5L21 3',
  loader: 'M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83',
  'check-circle': 'M22 11.08V12a10 10 0 1 1-5.93-9.14m5.93 1.14L12 17.01l-3-3',
  'x-circle': 'M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2zm3 7-6 6m0-6 6 6',
  'refresh-cw': 'M23 4v6h-6M1 20v-6h6m15.2-4a9 9 0 0 0-14.6-4.6L1 10M23 14l-4.6 4.6A9 9 0 0 1 1 14',
  'alert-triangle': 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4m0 4h.01',
  building: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zm6 11V12h6v8',
};

export function Icon({ name, size = 16, 'aria-hidden': ariaHidden = true, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={ariaHidden}
      className={className}
    >
      <path d={PATHS[name] ?? ''} />
    </svg>
  );
}
