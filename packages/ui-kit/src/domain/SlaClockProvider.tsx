/**
 * SlaClockProvider — single shared 1-second ticker for all SlaCountdown instances.
 *
 * Using one ticker per page instead of one per row keeps a 100-row queue at
 * one setInterval(1000) instead of 100.  All mounted SlaCountdown components
 * subscribe via context and receive a monotonically increasing `tick` count
 * that triggers their re-render.
 *
 * Injectable clock: pass `getMonoMs` to replace performance.now in tests.
 * An aria-live="polite" region is owned here so all mounted countdowns share
 * one announcement queue, preventing announcement storms on large queues.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

export interface SlaClockContextValue {
  /** Increments every second; components use this as a re-render trigger. */
  tick: number;
  /** Monotonic clock in ms; injected for deterministic tests. */
  getMonoMs: () => number;
  /**
   * Announce a state transition via the aria-live region.
   * Announces at most one message per 2s to avoid storms.
   */
  announce: (message: string) => void;
}

const defaultGetMonoMs = () =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

const SlaClockContext = createContext<SlaClockContextValue>({
  tick: 0,
  getMonoMs: defaultGetMonoMs,
  announce: () => undefined,
});

export interface SlaClockProviderProps {
  children: React.ReactNode;
  /** Replace performance.now for deterministic test control. */
  getMonoMs?: () => number;
  /** Tick interval in ms; default 1000. Exposed for faster tests. */
  tickIntervalMs?: number;
}

export function SlaClockProvider({
  children,
  getMonoMs = defaultGetMonoMs,
  tickIntervalMs = 1000,
}: SlaClockProviderProps) {
  const [tick, setTick] = useState(0);
  const [announcement, setAnnouncement] = useState('');
  const lastAnnounceRef = useRef(0);

  useEffect(() => {
    const id = setInterval(() => {
      setTick(t => t + 1);
    }, tickIntervalMs);
    return () => clearInterval(id);
  }, [tickIntervalMs]);

  const announce = useCallback(
    (message: string) => {
      const now = getMonoMs();
      if (now - lastAnnounceRef.current < 2000) return;
      lastAnnounceRef.current = now;
      setAnnouncement(message);
      // Clear after 3s so repeated identical strings still trigger re-announce
      setTimeout(() => setAnnouncement(''), 3000);
    },
    [getMonoMs],
  );

  return (
    <SlaClockContext.Provider value={{ tick, getMonoMs, announce }}>
      {children}
      {/* Single aria-live region shared across all countdowns on this page */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)' }}
      >
        {announcement}
      </div>
    </SlaClockContext.Provider>
  );
}

export function useSlaClockContext(): SlaClockContextValue {
  return useContext(SlaClockContext);
}
