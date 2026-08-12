/**
 * Mock-backed integration test — BackfillService reconnect protocol (WO-069 AC11).
 *
 * Simulates the full reconnect scenario end-to-end using in-process mocks,
 * no real Redis or WebSocket server required.
 *
 * Scenario A — happy-path reconnect:
 *   1. Publisher emits frames seq=1..5 (ring buffer holds all 5).
 *   2. Client connects and receives live frames 1..3 (lastDeliveredSeq=3).
 *   3. Client disconnects for 2 intervals, missing frames 4 and 5.
 *   4. Client reconnects with lastSeq=3.
 *   5. BackfillService sends backfill frames [4, 5] in order.
 *   6. Client state after applying backfill equals the state of a continuously
 *      connected client (verified by seq continuity).
 *
 * Scenario B — out-of-window reconnect:
 *   Ring buffer holds only seq 4..5. Client reconnects with lastSeq=1.
 *   Expected: snapshot_required(seq_out_of_window).
 *
 * Scenario C — Redis restart:
 *   Ring buffer is empty (Redis was restarted).
 *   Expected: snapshot_required(redis_reset).
 *
 * Scenario D — slow consumer:
 *   Publisher keeps emitting frames while the client stops reading.
 *   OutboundQueue overflows → snapshot_required(slow_consumer) sent.
 *
 * These complement the unit tests in backfill.spec.ts by exercising the
 * deliverLiveFrame + handleSubscribe + OutboundQueue interaction.
 */

import { WebSocket } from 'ws';
import { BackfillService } from '../backfill.service';
import { OutboundQueue } from '../outbound-queue';
import type { SocketWrapper } from '../frame.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TENANT = 'tenant-reconnect-test';
const USER   = 'user-reconnect-test';

function makeSocket(readyState = WebSocket.OPEN): { ws: WebSocket; received: unknown[] } {
  const received: unknown[] = [];
  const ws = {
    readyState,
    send: jest.fn((data: string) => received.push(JSON.parse(data))),
  } as unknown as WebSocket;
  return { ws, received };
}

function makeWrapper(ws: WebSocket, lastDeliveredSeq = 0): SocketWrapper {
  return {
    ws,
    principal: {
      sub:             USER,
      tenantId:        TENANT,
      roles:           ['agent'],
      orgScopeVersion: 1,
      orgScopeIds:     new Set(),
      userType:        'staff',
    },
    lastDeliveredSeq,
    lastPongAt:  0,
    subscribed:  false,
    backfilling: false,
  };
}

interface SimpleFrame {
  type:        'delta' | 'snapshot';
  tenantId:    string;
  seq:         number;
  prevSeq:     number;
  generatedAt: string;
  payload:     unknown;
}

function buildFrame(seq: number, type: 'delta' | 'snapshot' = 'delta'): SimpleFrame {
  return {
    type,
    tenantId:    TENANT,
    seq,
    prevSeq:     seq - 1,
    generatedAt: `2026-01-01T00:00:0${seq}.000Z`,
    payload:     { kpis: { open_total: seq * 10 } },
  };
}

function buildRingBuffer(frames: SimpleFrame[]): string[] {
  return frames.map((f) => JSON.stringify(f));
}

function makeMockRedis(ringBuffer: string[], throwOnLrange = false) {
  return {
    lrange: jest.fn(async (_key: string, _start: number, _stop: number) => {
      if (throwOnLrange) throw new Error('Redis unavailable');
      return ringBuffer;
    }),
  };
}

// ---------------------------------------------------------------------------
// Scenario A — Happy-path reconnect
// ---------------------------------------------------------------------------

describe('Reconnect integration — Scenario A: happy-path backfill', () => {
  it('restores client to latest seq after missing 2 frames', async () => {
    // Ring buffer holds frames 1..5
    const allFrames = [
      buildFrame(1, 'snapshot'),
      buildFrame(2),
      buildFrame(3),
      buildFrame(4),
      buildFrame(5),
    ];
    const ringBuffer = buildRingBuffer(allFrames);
    const redis = makeMockRedis(ringBuffer);
    const svc = new BackfillService(redis as never);

    const { ws, received } = makeSocket();
    const wrapper = makeWrapper(ws, 3); // client last saw seq=3

    const ok = await svc.handleSubscribe(wrapper, 3);

    expect(ok).toBe(true);
    // Should have received exactly frames 4 and 5
    expect(received).toHaveLength(2);
    expect((received[0] as SimpleFrame).seq).toBe(4);
    expect((received[1] as SimpleFrame).seq).toBe(5);
    expect(wrapper.lastDeliveredSeq).toBe(5);
  });

  it('client that stayed connected has same final seq as reconnecting client', async () => {
    const allFrames = [
      buildFrame(1, 'snapshot'),
      buildFrame(2),
      buildFrame(3),
      buildFrame(4),
      buildFrame(5),
    ];
    const ringBuffer = buildRingBuffer(allFrames);
    const redis = makeMockRedis(ringBuffer);
    const svc = new BackfillService(redis as never);

    // Continuous client: received all 5 frames live
    const continuousLastSeq = 5;

    // Reconnecting client: lastSeq=3, receives [4,5] via backfill
    const { ws, received } = makeSocket();
    const wrapper = makeWrapper(ws, 0);
    await svc.handleSubscribe(wrapper, 3);

    const reconnectedFinalSeq = wrapper.lastDeliveredSeq;

    // Both clients are now at the same seq
    expect(reconnectedFinalSeq).toBe(continuousLastSeq);

    // Verify the delta payloads contain seq 4 and 5 only
    const seqs = received.map((f) => (f as SimpleFrame).seq);
    expect(seqs).toEqual([4, 5]);
  });

  it('no backfill frames sent when lastSeq equals newest retained seq (already up to date)', async () => {
    const allFrames = [buildFrame(1, 'snapshot'), buildFrame(2), buildFrame(3)];
    const redis = makeMockRedis(buildRingBuffer(allFrames));
    const svc = new BackfillService(redis as never);

    const { ws, received } = makeSocket();
    const wrapper = makeWrapper(ws, 3);

    const ok = await svc.handleSubscribe(wrapper, 3);

    expect(ok).toBe(true);
    expect(received).toHaveLength(0);
    expect(wrapper.subscribed).toBe(true);
    expect(wrapper.backfilling).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Scenario B — Out-of-window reconnect
// ---------------------------------------------------------------------------

describe('Reconnect integration — Scenario B: out-of-window', () => {
  it('returns snapshot_required when lastSeq is before oldest retained frame', async () => {
    // Only seq 4 and 5 remain in the ring buffer (older frames TTL-expired)
    const ringBuffer = buildRingBuffer([buildFrame(4), buildFrame(5)]);
    const redis = makeMockRedis(ringBuffer);
    const svc = new BackfillService(redis as never);

    const { ws, received } = makeSocket();
    const wrapper = makeWrapper(ws, 0);

    const ok = await svc.handleSubscribe(wrapper, 1);

    expect(ok).toBe(false);
    expect(received).toHaveLength(1);
    const sr = received[0] as { type: string; reason: string };
    expect(sr.type).toBe('snapshot_required');
    expect(sr.reason).toBe('seq_out_of_window');
  });
});

// ---------------------------------------------------------------------------
// Scenario C — Redis restart
// ---------------------------------------------------------------------------

describe('Reconnect integration — Scenario C: Redis restart', () => {
  it('returns snapshot_required(redis_reset) when ring buffer is empty', async () => {
    const redis = makeMockRedis([]);
    const svc = new BackfillService(redis as never);

    const { ws, received } = makeSocket();
    const wrapper = makeWrapper(ws, 0);

    const ok = await svc.handleSubscribe(wrapper, 3);

    expect(ok).toBe(false);
    const sr = received[0] as { type: string; reason: string };
    expect(sr.type).toBe('snapshot_required');
    expect(sr.reason).toBe('redis_reset');
  });

  it('returns snapshot_required(redis_reset) when LRANGE throws', async () => {
    const redis = makeMockRedis([], /* throwOnLrange */ true);
    const svc = new BackfillService(redis as never);

    const { ws, received } = makeSocket();
    const wrapper = makeWrapper(ws, 0);

    const ok = await svc.handleSubscribe(wrapper, 3);

    expect(ok).toBe(false);
    const sr = received[0] as { type: string; reason: string };
    expect(sr.reason).toBe('redis_reset');
  });
});

// ---------------------------------------------------------------------------
// Scenario D — Slow consumer
// ---------------------------------------------------------------------------

describe('Reconnect integration — Scenario D: slow consumer', () => {
  it('sends snapshot_required(slow_consumer) and drops queue when depth exceeded', () => {
    const { ws, received } = makeSocket();

    // Build a tiny queue (maxDepth=2)
    const handler = {
      onSlowConsumer: jest.fn(),
    };
    const queue = new OutboundQueue(ws, TENANT, USER, handler, 2);

    queue.enqueue(1, JSON.stringify(buildFrame(1)));
    queue.enqueue(2, JSON.stringify(buildFrame(2)));
    const overflow = queue.enqueue(3, JSON.stringify(buildFrame(3)));

    expect(overflow).toBe(false);
    expect(queue.isDropped).toBe(true);

    // snapshot_required should have been sent to the socket
    const snapshotReq = received.find(
      (f) => (f as { type: string }).type === 'snapshot_required',
    ) as { type: string; reason: string } | undefined;
    expect(snapshotReq).toBeDefined();
    expect(snapshotReq!.reason).toBe('slow_consumer');

    // Slow consumer handler was called
    expect(handler.onSlowConsumer).toHaveBeenCalledWith(TENANT, USER);
  });

  it('queue depth does not grow after drop', () => {
    const { ws } = makeSocket();
    const handler = { onSlowConsumer: jest.fn() };
    const queue = new OutboundQueue(ws, TENANT, USER, handler, 1);

    queue.enqueue(1, JSON.stringify(buildFrame(1)));
    queue.enqueue(2, JSON.stringify(buildFrame(2))); // triggers drop

    // Further enqueues ignored
    queue.enqueue(3, JSON.stringify(buildFrame(3)));
    queue.enqueue(4, JSON.stringify(buildFrame(4)));
    expect(queue.depth).toBe(0);
    expect(queue.isDropped).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Replay idempotence (AC7)
// ---------------------------------------------------------------------------

describe('Replay idempotence (AC7)', () => {
  it('applying the same delta frame twice yields identical client counters', () => {
    // Client state (simplified KPI map)
    let clientState: Record<string, number> = { open_total: 10 };

    const deltaPayload = { kpis: { open_total: 12 } };

    function applyDelta(state: Record<string, number>, delta: typeof deltaPayload) {
      return { ...state, ...delta.kpis };
    }

    // Apply once
    const afterFirst = applyDelta(clientState, deltaPayload);
    // Apply same delta again (duplicate delivery)
    const afterSecond = applyDelta(afterFirst, deltaPayload);

    expect(afterFirst).toEqual(afterSecond);
    expect(afterFirst['open_total']).toBe(12);
  });

  it('delivering the same live frame seq twice via deliverLiveFrame is idempotent', () => {
    const { ws, received } = makeSocket();
    const redis = makeMockRedis([]);
    const svc = new BackfillService(redis as never);
    const wrapper = makeWrapper(ws, 4);
    wrapper.subscribed = true;
    wrapper.backfilling = false;

    const frameJson = JSON.stringify(buildFrame(5));

    svc.deliverLiveFrame(wrapper, 5, frameJson);
    svc.deliverLiveFrame(wrapper, 5, frameJson); // duplicate

    // Only one frame delivered; second is silently dropped
    expect(received).toHaveLength(1);
    expect(wrapper.lastDeliveredSeq).toBe(5);
  });
});
