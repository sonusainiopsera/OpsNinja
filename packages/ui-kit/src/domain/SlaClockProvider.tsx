/**
 * SlaClockProvider — single shared 1-second ticker for all SlaCountdown instances.
 *
 * Design (from WO-019):
 *   - ONE ticker per page; each SlaCountdown subscribes rather than owning its own interval.
 *   - Monotonic clock (`performance.now`) tracks time since the last server delta to avoid
 *     wall-clock skew and resume-from-sleep jumps.
 *   - Clock is dependency-injected (`clock` prop) so tests can use fake timers deterministically.
 *   - A single `aria-live="polite"` region announces state transitions at most once per
 *     transition to avoid announcement storms on large queues.
 *
 * Usage:
 *   <SlaClockProvider>          // at app/page level
 *     <TicketQueue />            // contains many <SlaCountdown> rows
 *   </SlaClockProvider>
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export interface MonotonicClock {
  /** Returns elapsed milliseconds since an unspecified epoch (like performance.now). */
  now: () => number;
}

/** Tick payload delivered to each subscriber every ~1 second. */
export interface ClockTick {
  /** performance.now() at the moment of the tick. */
  currentMs: number;
}

type TickSubscriber = (tick: ClockTick) => void;

interface SlaClockContextValue {
  /** Subscribe to 1-second ticks. Returns an unsubscribe function. */
  subscribe: (cb: TickSubscriber) => () => void;
  /** Emit a polite aria-live announcement (deduplicated per message per second). */
  announce: (message: string) => void;
  /** Exposed clock for monotonic offset capture in SlaCountdown. */
  clock: MonotonicClock;
}

const defaultClock: MonotonicClock = {
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
};

const SlaClockContext = createContext<SlaClockContextValue | null>(null);

interface SlaClockProviderProps {
  children: ReactNode;
  /** Injectable clock for deterministic tests. Defaults to performance.now. */
  clock?: MonotonicClock;
  /** Tick interval in ms (default 1000). Lower for tests. */
  intervalMs?: number;
  /**
   * Convenience alias for `clock.now` — accepts a plain function instead of
   * a MonotonicClock object. Takes precedence over `clock` when provided.
   */
  getMonoMs?: () => number;
  /**
   * Convenience alias for `intervalMs` — matches the test fixture prop name.
   * Takes precedence over `intervalMs` when provided.
   */
  tickIntervalMs?: number;
}

export function SlaClockProvider({
  children,
  clock = defaultClock,
  intervalMs = 1000,
  getMonoMs,
  tickIntervalMs,
}: SlaClockProviderProps) {
  // Resolve convenience aliases: getMonoMs wraps into a MonotonicClock,
  // tickIntervalMs overrides intervalMs.
  const resolvedClock: MonotonicClock = getMonoMs ? { now: getMonoMs } : clock;
  const resolvedIntervalMs = tickIntervalMs ?? intervalMs;
  const subscribersRef = useRef<Set<TickSubscriber>>(new Set());
  const [announcement, setAnnouncement] = useState('');
  const announcedRef = useRef<Set<string>>(new Set());

  const subscribe = useCallback((cb: TickSubscriber) => {
    subscribersRef.current.add(cb);
    return () => {
      subscribersRef.current.delete(cb);
    };
  }, []);

  const announce = useCallback((message: string) => {
    if (!message) return;
    // Deduplicate: same message within the same second is only announced once.
    if (announcedRef.current.has(message)) return;
    announcedRef.current.add(message);
    setAnnouncement(message);
    // Clear dedup set after 2 seconds so the same state can be announced again
    // if the component unmounts and remounts (new ticket row).
    setTimeout(() => {
      announcedRef.current.delete(message);
    }, 2000);
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      const tick: ClockTick = { currentMs: resolvedClock.now() };
      subscribersRef.current.forEach((cb) => cb(tick));
    }, resolvedIntervalMs);
    return () => clearInterval(id);
  }, [resolvedClock, resolvedIntervalMs]);

  const value: SlaClockContextValue = { subscribe, announce, clock: resolvedClock };

  return (
    <SlaClockContext.Provider value={value}>
      {children}
      {/* Single aria-live region for all countdown announcements on the page. */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}
      >
        {announcement}
      </div>
    </SlaClockContext.Provider>
  );
}

export function useSlaClockContext(): SlaClockContextValue {
  const ctx = useContext(SlaClockContext);
  if (!ctx) {
    // Fallback when used outside a provider (e.g. in Storybook stories).
    return {
      subscribe: (cb) => {
        const id = setInterval(() => cb({ currentMs: defaultClock.now() }), 1000);
        return () => clearInterval(id);
      },
      announce: () => undefined,
      clock: defaultClock,
    };
  }
  return ctx;
}
