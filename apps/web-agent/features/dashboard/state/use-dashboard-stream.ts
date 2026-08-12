'use client';
/**
 * useDashboardStream — stream hook implementing the dashboard connection
 * state machine (WO-070, AC2, AC5, AC8).
 *
 * State machine:
 *   connecting → (snapshot ok, ws connect ok) → backfilling → live
 *   live        → (ws close/error) → reconnecting → (backoff) → connecting
 *   live        → (snapshot_required frame) → connecting (refetch + resubscribe)
 *   connecting  → (seq null / degraded) → polling   (30s poll, no WS)
 *   polling     → (ws reconnect ok)     → connecting
 *   any         → (tab hidden)          → pause polling
 *
 * The hook is the only place that owns the WebSocket and polling interval.
 * It writes to useRealtimeStatusStore so LiveStatusPill reflects state.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { applyFrame, INITIAL_DASHBOARD_STATE } from './apply-delta';
import type { DashboardState, IncomingFrame } from './apply-delta';
import { fetchDashboardSnapshot } from '../../../lib/api/dashboard';
import { useRealtimeStatusStore } from '../../../lib/store/realtimeStatus.store';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const WS_BASE_URL =
  (typeof process !== 'undefined' && process.env['NEXT_PUBLIC_WS_URL']) ||
  (typeof window !== 'undefined' ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}` : '');

const POLL_INTERVAL_MS = 30_000;
const MAX_BACKOFF_MS = 30_000;
const INITIAL_BACKOFF_MS = 1_000;
/** Refetch snapshot if tab was hidden longer than this before wake. */
const STALE_SLEEP_THRESHOLD_MS = 60_000;

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export type StreamStatus =
  | 'connecting'
  | 'backfilling'
  | 'live'
  | 'reconnecting'
  | 'polling'
  | 'stale';

export interface DashboardStreamState {
  status: StreamStatus;
  data: DashboardState;
  lastError: string | null;
  /** true when snapshot.degraded was true on last fetch */
  degraded: boolean;
  degradedReason: string | null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDashboardStream(): DashboardStreamState {
  const setRealtimeStatus = useRealtimeStatusStore((s) => s.setStatus);

  const [streamState, setStreamState] = useState<DashboardStreamState>({
    status: 'connecting',
    data: INITIAL_DASHBOARD_STATE,
    lastError: null,
    degraded: false,
    degradedReason: null,
  });

  // Refs so callbacks close over stable values, not stale state.
  const wsRef = useRef<WebSocket | null>(null);
  const dataRef = useRef<DashboardState>(INITIAL_DASHBOARD_STATE);
  const backoffRef = useRef<number>(INITIAL_BACKOFF_MS);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const hiddenAtRef = useRef<number | null>(null);

  const updateState = useCallback((patch: Partial<DashboardStreamState>) => {
    if (!mountedRef.current) return;
    setStreamState((prev) => {
      const next = { ...prev, ...patch };
      // Sync store for LiveStatusPill
      const storeStatus = streamStatusToStore(next.status);
      setRealtimeStatus(storeStatus);
      return next;
    });
  }, [setRealtimeStatus]);

  // ---------------------------------------------------------------------------
  // Snapshot fetch
  // ---------------------------------------------------------------------------

  const fetchSnapshot = useCallback(async (): Promise<void> => {
    updateState({ status: 'connecting', lastError: null });
    try {
      const snap = await fetchDashboardSnapshot();

      if (!mountedRef.current) return;

      // Hydrate data from snapshot
      const syntheticFrame: IncomingFrame = {
        type: 'snapshot',
        seq: snap.seq ?? 0,
        prevSeq: 0,
        generatedAt: snap.generatedAt,
        payload: snap,
      };
      const next = applyFrame(INITIAL_DASHBOARD_STATE, syntheticFrame);
      dataRef.current = next;

      if (snap.degraded || snap.seq === null) {
        // Cannot join WebSocket — go straight to polling
        updateState({
          status: 'polling',
          data: next,
          degraded: true,
          degradedReason: snap.degradedReason ?? 'Data is delayed',
        });
        startPolling();
        return;
      }

      updateState({
        status: 'backfilling',
        data: next,
        degraded: snap.degraded,
        degradedReason: null,
      });

      // Subscribe WebSocket with snapshot seq
      connectWebSocket(snap.seq);
    } catch (err) {
      if (!mountedRef.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      updateState({ status: 'reconnecting', lastError: msg });
      scheduleReconnect();
    }
  }, [updateState]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // WebSocket
  // ---------------------------------------------------------------------------

  const connectWebSocket = useCallback((lastSeq: number) => {
    closeWebSocket();

    const url = `${WS_BASE_URL}/ws`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      scheduleReconnect();
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) { ws.close(); return; }
      backoffRef.current = INITIAL_BACKOFF_MS; // reset on successful connect
      // Send subscribe message with lastSeq for backfill
      ws.send(JSON.stringify({ type: 'subscribe', channel: 'dashboard', lastSeq }));
    };

    ws.onmessage = (event: MessageEvent<string>) => {
      if (!mountedRef.current) return;
      handleFrame(event.data);
    };

    ws.onclose = (event) => {
      if (!mountedRef.current) return;
      handleClose(event.code, event.reason);
    };

    ws.onerror = () => {
      // onerror is always followed by onclose; let onclose handle it.
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFrame = useCallback((raw: string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return;
    }

    if (typeof parsed !== 'object' || parsed === null) return;
    const frame = parsed as Record<string, unknown>;

    if (frame['type'] === 'hello') {
      updateState({ status: 'live' });
      return;
    }

    if (frame['type'] === 'ping') {
      wsRef.current?.send(JSON.stringify({ type: 'pong' }));
      return;
    }

    if (frame['type'] === 'snapshot_required') {
      // Refetch snapshot and resubscribe
      closeWebSocket();
      fetchSnapshot();
      return;
    }

    if (frame['type'] === 'going_away') {
      closeWebSocket();
      scheduleReconnect();
      return;
    }

    if (frame['type'] === 'delta' || frame['type'] === 'snapshot') {
      const incomingFrame: IncomingFrame = {
        type: frame['type'] as 'delta' | 'snapshot',
        seq: (frame['seq'] as number) ?? 0,
        prevSeq: (frame['prevSeq'] as number) ?? 0,
        generatedAt: (frame['generatedAt'] as string) ?? new Date().toISOString(),
        payload: frame['payload'],
      };

      const next = applyFrame(dataRef.current, incomingFrame);
      dataRef.current = next;

      if (next.seqGap) {
        // Seq gap — refetch snapshot
        closeWebSocket();
        fetchSnapshot();
        return;
      }

      if (next.validationFailures >= 3) {
        closeWebSocket();
        fetchSnapshot();
        return;
      }

      updateState({ status: 'live', data: next });
    }
  }, [fetchSnapshot, updateState]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClose = useCallback((code: number, _reason: string) => {
    if (!mountedRef.current) return;
    wsRef.current = null;

    // 4401/4440 = auth failure → prompt re-auth (handled by apiClient session event)
    // 4429/503  = rate limited → go straight to polling
    if (code === 4429) {
      updateState({ status: 'polling' });
      startPolling();
      return;
    }

    updateState({ status: 'reconnecting' });
    scheduleReconnect();
  }, [updateState]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Polling fallback
  // ---------------------------------------------------------------------------

  const startPolling = useCallback(() => {
    stopPolling();
    pollTimerRef.current = setInterval(() => {
      if (document.hidden) return; // pause when tab hidden
      fetchSnapshot();
    }, POLL_INTERVAL_MS);
  }, [fetchSnapshot]); // eslint-disable-line react-hooks/exhaustive-deps

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Reconnect with exponential backoff + jitter
  // ---------------------------------------------------------------------------

  const scheduleReconnect = useCallback(() => {
    if (reconnectTimerRef.current !== null) return; // already scheduled
    const jitter = Math.random() * 1000;
    const delay = Math.min(backoffRef.current + jitter, MAX_BACKOFF_MS);
    backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS);

    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      if (!mountedRef.current) return;
      fetchSnapshot();
    }, delay);
  }, [fetchSnapshot]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Cleanup helpers
  // ---------------------------------------------------------------------------

  const closeWebSocket = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close(1000, 'component unmount');
      wsRef.current = null;
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Page Visibility — pause polling on hide, detect stale on show
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        hiddenAtRef.current = Date.now();
        return;
      }
      // Woke up
      const hiddenAt = hiddenAtRef.current;
      hiddenAtRef.current = null;
      if (hiddenAt !== null && Date.now() - hiddenAt > STALE_SLEEP_THRESHOLD_MS) {
        // Slept for > 1 min — current seq is likely stale, force refetch
        closeWebSocket();
        stopPolling();
        fetchSnapshot();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [closeWebSocket, fetchSnapshot, stopPolling]);

  // ---------------------------------------------------------------------------
  // Mount / unmount
  // ---------------------------------------------------------------------------

  useEffect(() => {
    mountedRef.current = true;
    fetchSnapshot();

    return () => {
      mountedRef.current = false;
      closeWebSocket();
      stopPolling();
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return streamState;
}

// ---------------------------------------------------------------------------
// Map stream status → realtime store status
// ---------------------------------------------------------------------------

function streamStatusToStore(
  s: StreamStatus,
): 'connected' | 'reconnecting' | 'polling' | 'stale' | 'offline' {
  switch (s) {
    case 'live': return 'connected';
    case 'connecting':
    case 'backfilling':
    case 'reconnecting': return 'reconnecting';
    case 'polling': return 'polling';
    case 'stale': return 'stale';
  }
}
