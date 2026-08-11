import type { RealtimeStatus } from '@/lib/stores/realtimeStatusStore';

export const realtimeStatuses: RealtimeStatus[] = ['connected', 'reconnecting', 'offline'];

export const realtimeStatusLabels: Record<RealtimeStatus, string> = {
  connected:    'Live',
  reconnecting: 'Reconnecting',
  offline:      'Offline',
};

export const realtimeStatusAriaLabels: Record<RealtimeStatus, string> = {
  connected:    'Realtime connection: connected',
  reconnecting: 'Realtime connection: reconnecting',
  offline:      'Realtime connection: offline',
};
