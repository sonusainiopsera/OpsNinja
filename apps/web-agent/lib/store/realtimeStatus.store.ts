/**
 * Realtime connection status store — view state only.
 *
 * The shell reads this store; the realtime client layer writes to it.
 * The shell NEVER opens or manages the WebSocket itself.
 *
 * WO-070: extended with 'polling' (WS unavailable, polling snapshot) and
 * 'stale' (data delayed, degraded snapshot with null seq).
 */

import { create } from 'zustand';

export type RealtimeStatus =
  | 'connected'   // WebSocket live, receiving deltas
  | 'reconnecting' // WebSocket lost, attempting reconnect
  | 'polling'     // WebSocket unavailable; polling /snapshot every 30 s
  | 'stale'       // Degraded snapshot (null seq); polling with delayed-data banner
  | 'offline';    // No connectivity at all

interface RealtimeStatusState {
  status: RealtimeStatus;
  setStatus: (status: RealtimeStatus) => void;
}

export const useRealtimeStatusStore = create<RealtimeStatusState>((set) => ({
  status: 'offline',
  setStatus: (status) => set({ status }),
}));
