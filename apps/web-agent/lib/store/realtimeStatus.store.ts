/**
 * Realtime connection status store — view state only.
 *
 * The shell reads this store; the realtime client layer writes to it.
 * The shell NEVER opens or manages the WebSocket itself.
 */

import { create } from 'zustand';

export type RealtimeStatus = 'connected' | 'reconnecting' | 'offline';

interface RealtimeStatusState {
  status: RealtimeStatus;
  setStatus: (status: RealtimeStatus) => void;
}

export const useRealtimeStatusStore = create<RealtimeStatusState>((set) => ({
  status: 'offline',
  setStatus: (status) => set({ status }),
}));
