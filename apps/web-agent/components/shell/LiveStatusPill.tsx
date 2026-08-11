'use client';

/**
 * LiveStatusPill — reflects realtime WebSocket connection health.
 *
 * Reads from Zustand store (written by the realtime client layer).
 * The shell never opens or manages the WebSocket itself.
 * State communicated by icon + text label (not colour alone).
 *
 * Debounces status changes by 800ms to prevent UI thrash on flapping.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Icon } from '@opsninja/ui-kit';
import { useRealtimeStatusStore, type RealtimeStatus } from '../../lib/store/realtimeStatus.store';

interface StatusConfig {
  label: string;
  iconName: 'check-circle' | 'refresh-cw' | 'x-circle';
  colorVar: string;
  bgVar: string;
}

const STATUS_CONFIG: Record<RealtimeStatus, StatusConfig> = {
  connected: {
    label: 'Live',
    iconName: 'check-circle',
    colorVar: '--rt-connected-fg',
    bgVar: '--rt-connected-bg',
  },
  reconnecting: {
    label: 'Reconnecting',
    iconName: 'refresh-cw',
    colorVar: '--rt-reconnecting-fg',
    bgVar: '--rt-reconnecting-bg',
  },
  polling: {
    label: 'Polling',
    iconName: 'refresh-cw',
    colorVar: '--rt-polling-fg',
    bgVar: '--rt-polling-bg',
  },
  stale: {
    label: 'Delayed',
    iconName: 'x-circle',
    colorVar: '--rt-stale-fg',
    bgVar: '--rt-stale-bg',
  },
  offline: {
    label: 'Offline',
    iconName: 'x-circle',
    colorVar: '--rt-offline-fg',
    bgVar: '--rt-offline-bg',
  },
};

export const REALTIME_STATUS_CSS_VARS = `
  --rt-connected-fg: #14532d; --rt-connected-bg: #f0fdf4;
  --rt-reconnecting-fg: #78350f; --rt-reconnecting-bg: #fff7ed;
  --rt-polling-fg: #1d4ed8; --rt-polling-bg: #eff6ff;
  --rt-stale-fg: #92400e; --rt-stale-bg: #fffbeb;
  --rt-offline-fg: #991b1b; --rt-offline-bg: #fef2f2;
`;

const DEBOUNCE_MS = 800;

export function LiveStatusPill() {
  const rawStatus = useRealtimeStatusStore((s) => s.status);
  const [displayStatus, setDisplayStatus] = useState<RealtimeStatus>(rawStatus);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setDisplayStatus(rawStatus);
    }, DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [rawStatus]);

  const config = STATUS_CONFIG[displayStatus];

  return (
    <span
      data-realtime-status={displayStatus}
      aria-label={`Realtime connection: ${config.label}`}
      title={`Realtime connection: ${config.label}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: 9999,
        fontSize: 12,
        fontWeight: 500,
        background: `var(${config.bgVar})`,
        color: `var(${config.colorVar})`,
        userSelect: 'none',
      }}
    >
      <Icon name={config.iconName} size={12} />
      <span>{config.label}</span>
    </span>
  );
}
