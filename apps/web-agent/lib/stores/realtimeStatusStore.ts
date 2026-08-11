/**
 * realtimeStatusStore — Zustand store for WebSocket connection health.
 *
 * The shell only READS this store; it never opens the WebSocket.
 * The realtime gateway client (WOREF-021) writes connection state here.
 *
 * Includes debounce logic to prevent flapping between states when the
 * connection drops and reconnects within a 2s window.
 */

import { create } from 'zustand';

export type RealtimeStatus = 'connected' | 'reconnecting' | 'offline';

interface RealtimeStatusState {
  status: RealtimeStatus;
  lastChangedAt: number;
  /** Called by the realtime client — not by the shell. */
  setStatus: (status: RealtimeStatus) => void;
}

const DEBOUNCE_MS = 2000;

export const useRealtimeStatusStore = create<RealtimeStatusState>((set, get) => ({
  status: 'offline',
  lastChangedAt: 0,
  setStatus(newStatus) {
    const now = Date.now();
    const { status, lastChangedAt } = get();

    // Debounce: ignore transient flaps shorter than DEBOUNCE_MS
    if (newStatus === status) return;
    if (now - lastChangedAt < DEBOUNCE_MS && newStatus === 'reconnecting') return;

    set({ status: newStatus, lastChangedAt: now });
  },
}));
