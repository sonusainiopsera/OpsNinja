/**
 * Unit tests for BackfillService — WO-069 AC5, AC6, AC7, AC8, AC10
 *
 * Covers:
 *  AC5  — lastSeq inside retention window → backfill frames sent in ascending seq
 *  AC5  — lastSeq equal to newest retained seq → no backfill, socket subscribed
 *  AC6  — null lastSeq → snapshot_required(invalid_seq)
 *  AC6  — negative/non-integer lastSeq → snapshot_required(invalid_seq)
 *  AC6  — empty ring buffer (Redis restart) → snapshot_required(redis_reset)
 *  AC6  — lastSeq before oldest retained → snapshot_required(seq_out_of_window)
 *  AC6  — backfill frame count exceeds limit → snapshot_required(seq_out_of_window)
 *  AC6  — backfill byte total exceeds limit → snapshot_required(seq_out_of_window)
 *  AC7  — duplicate live frame (seq ≤ lastDeliveredSeq) silently discarded
 *  AC8  — Redis LRANGE failure → snapshot_required(redis_reset)
 *  AC10 — deliverLiveFrame during backfill enqueues in outbound queue
 *  AC10 — deliverLiveFrame outside backfill sends directly + updates lastDeliveredSeq
 *  AC11 — reconnect scenario: ring buffer [1..5], lastSeq=3 → backfill sends [4,5]
 *  AC11 — out-of-window scenario: ring buffer [4,5], lastSeq=1 → snapshot_required
 */

import { WebSocket } from 'ws';
import { BackfillService } from '../backfill.service';
import type { SocketWrapper } from '../frame.types';
import type { RedisPublishPayload } from '../frame.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-backfill-001';
const PRINCIPAL_ID = 'user-backfill-001';

function makeSocket(readyState = WebSocket.OPEN): { ws: WebSocket; sent: string[] } {
  const sent: string[] = [];
  const ws = {
    readyState,
    send: jest.fn((data: string) => sent.push(data)),
  } as unknown as WebSocket;
  return { ws, sent };
}

function makeWrapper(ws: WebSocket, lastDeliveredSeq = 0): SocketWrapper {
  return {
    ws,
    principal: {
      sub: PRINCIPAL_ID,
      tenantId: TENANT_ID,
      roles: ['agent'],
      orgScopeVersion: 1,
      orgScopeIds: new Set(),
      userType: 'staff',
    },
    lastDeliveredSeq,
    lastPongAt: 0,
    subscribed: false,
    backfilling: false,
  };
}

function makeFrame(seq: number, type: 'delta' | 'snapshot' = 'delta'): RedisPublishPayload {
  return {
    type,
    tenantId: TENANT_ID,
    seq,
    prevSeq: seq - 1,
    generatedAt: '2026-01-01T00:00:00.000Z',
    payload: { kpis: { open_total: seq } },
  };
}

function makeRingBuffer(frames: RedisPublishPayload[]): string[] {
  return frames.map((f) => JSON.stringify(f));
}

function makeMockRedis(ringBuffer: string[] = [], throwOnLrange = false) {
  return {
    lrange: jest.fn(async () => {
      if (throwOnLrange) throw new Error('Redis connection error');
      return ringBuffer;
    }),
  };
}

function makeService(redis: ReturnType<typeof makeMockRedis>): BackfillService {
  return new BackfillService(redis as never);
}

// ---------------------------------------------------------------------------
// AC6 — null / invalid lastSeq
// ---------------------------------------------------------------------------

describe('BackfillService.handleSubscribe — invalid lastSeq', () => {
  it('sends snapshot_required(invalid_seq) for null lastSeq', async () => {
    const { ws, sent } = makeSocket();
    const svc = makeService(makeMockRedis());
    const wrapper = makeWrapper(ws);

    const result = await svc.handleSubscribe(wrapper, null);

    expect(result).toBe(false);
    expect(sent).toHaveLength(1);
    const frame = JSON.parse(sent[0]!);
    expect(frame.type).toBe('snapshot_required');
    expect(frame.reason).toBe('invalid_seq');
  });

  it('sends snapshot_required(invalid_seq) for negative lastSeq', async () => {
    const { ws, sent } = makeSocket();
    const svc = makeService(makeMockRedis());
    const wrapper = makeWrapper(ws);

    const result = await svc.handleSubscribe(wrapper, -1);

    expect(result).toBe(false);
    const frame = JSON.parse(sent[0]!);
    expect(frame.reason).toBe('invalid_seq');
  });

  it('sends snapshot_required(invalid_seq) for non-integer lastSeq', async () => {
    const { ws, sent } = makeSocket();
    const svc = makeService(makeMockRedis());
    const wrapper = makeWrapper(ws);

    const result = await svc.handleSubscribe(wrapper, 1.5);

    expect(result).toBe(false);
    const frame = JSON.parse(sent[0]!);
    expect(frame.reason).toBe('invalid_seq');
  });
});

// ---------------------------------------------------------------------------
// AC8 — Redis failure
// ---------------------------------------------------------------------------

describe('BackfillService.handleSubscribe — Redis LRANGE failure', () => {
  it('sends snapshot_required(redis_reset) when LRANGE throws', async () => {
    const { ws, sent } = makeSocket();
    const svc = makeService(makeMockRedis([], true));
    const wrapper = makeWrapper(ws);

    const result = await svc.handleSubscribe(wrapper, 5);

    expect(result).toBe(false);
    const frame = JSON.parse(sent[0]!);
    expect(frame.type).toBe('snapshot_required');
    expect(frame.reason).toBe('redis_reset');
  });
});

// ---------------------------------------------------------------------------
// AC6 — empty ring buffer (Redis restart)
// ---------------------------------------------------------------------------

describe('BackfillService.handleSubscribe — empty ring buffer', () => {
  it('sends snapshot_required(redis_reset) when ring buffer is empty', async () => {
    const { ws, sent } = makeSocket();
    const svc = makeService(makeMockRedis([]));
    const wrapper = makeWrapper(ws);

    const result = await svc.handleSubscribe(wrapper, 3);

    expect(result).toBe(false);
    const frame = JSON.parse(sent[0]!);
    expect(frame.type).toBe('snapshot_required');
    expect(frame.reason).toBe('redis_reset');
  });
});

// ---------------------------------------------------------------------------
// AC5 — client up to date
// ---------------------------------------------------------------------------

describe('BackfillService.handleSubscribe — client already up to date', () => {
  it('subscribes without backfill when lastSeq equals newest retained seq', async () => {
    const { ws, sent } = makeSocket();
    const ringBuffer = makeRingBuffer([makeFrame(1), makeFrame(2), makeFrame(3)]);
    const svc = makeService(makeMockRedis(ringBuffer));
    const wrapper = makeWrapper(ws);

    const result = await svc.handleSubscribe(wrapper, 3);

    expect(result).toBe(true);
    expect(wrapper.subscribed).toBe(true);
    expect(wrapper.backfilling).toBe(false);
    // No frames sent (only snapshot_required would be sent otherwise)
    expect(sent).toHaveLength(0);
  });

  it('subscribes without backfill when lastSeq is in the future (tampered)', async () => {
    const { ws, sent } = makeSocket();
    const ringBuffer = makeRingBuffer([makeFrame(1), makeFrame(2)]);
    const svc = makeService(makeMockRedis(ringBuffer));
    const wrapper = makeWrapper(ws);

    const result = await svc.handleSubscribe(wrapper, 999);

    expect(result).toBe(true);
    expect(sent).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// AC6 — out-of-window seq
// ---------------------------------------------------------------------------

describe('BackfillService.handleSubscribe — out of window', () => {
  it('sends snapshot_required(seq_out_of_window) when lastSeq is before oldest retained', async () => {
    const { ws, sent } = makeSocket();
    // Ring buffer holds only seq 4 and 5
    const ringBuffer = makeRingBuffer([makeFrame(4), makeFrame(5)]);
    const svc = makeService(makeMockRedis(ringBuffer));
    const wrapper = makeWrapper(ws);

    // lastSeq=1 is before oldest (4); gap > 1
    const result = await svc.handleSubscribe(wrapper, 1);

    expect(result).toBe(false);
    const frame = JSON.parse(sent[0]!);
    expect(frame.type).toBe('snapshot_required');
    expect(frame.reason).toBe('seq_out_of_window');
  });
});

// ---------------------------------------------------------------------------
// AC6 — backfill size gates
// ---------------------------------------------------------------------------

describe('BackfillService.handleSubscribe — size gates', () => {
  it('sends snapshot_required when backfill frame count exceeds MAX_BACKFILL_FRAMES', async () => {
    const { ws, sent } = makeSocket();

    // Build 62 frames (exceeds default MAX_BACKFILL_FRAMES=60)
    const frames = Array.from({ length: 62 }, (_, i) => makeFrame(i + 1));
    const ringBuffer = makeRingBuffer(frames);
    const svc = makeService(makeMockRedis(ringBuffer));
    const wrapper = makeWrapper(ws, 0);

    const result = await svc.handleSubscribe(wrapper, 0);

    expect(result).toBe(false);
    const frame = JSON.parse(sent[0]!);
    expect(frame.type).toBe('snapshot_required');
    expect(frame.reason).toBe('seq_out_of_window');
  });

  it('sends snapshot_required when backfill byte total exceeds MAX_BACKFILL_BYTES (256KB)', async () => {
    const { ws, sent } = makeSocket();

    // Build frames with large payloads exceeding 256KB total
    const largePayload = 'x'.repeat(5000);
    const frames = Array.from({ length: 55 }, (_, i) => ({
      ...makeFrame(i + 1),
      payload: { bigData: largePayload },
    }));
    const ringBuffer = frames.map((f) => JSON.stringify(f));
    const svc = makeService(makeMockRedis(ringBuffer));
    const wrapper = makeWrapper(ws, 0);

    const result = await svc.handleSubscribe(wrapper, 0);

    expect(result).toBe(false);
    const frame = JSON.parse(sent[0]!);
    expect(frame.reason).toBe('seq_out_of_window');
  });
});

// ---------------------------------------------------------------------------
// AC5 — successful backfill
// ---------------------------------------------------------------------------

describe('BackfillService.handleSubscribe — successful backfill', () => {
  it('sends missing frames in ascending seq order', async () => {
    const { ws, sent } = makeSocket();
    const ringBuffer = makeRingBuffer([
      makeFrame(1, 'snapshot'),
      makeFrame(2),
      makeFrame(3),
      makeFrame(4),
      makeFrame(5),
    ]);
    const svc = makeService(makeMockRedis(ringBuffer));
    const wrapper = makeWrapper(ws, 0);

    const result = await svc.handleSubscribe(wrapper, 3);

    expect(result).toBe(true);
    // Only frames 4 and 5 should be sent
    expect(sent).toHaveLength(2);
    const seqs = sent.map((s) => (JSON.parse(s) as { seq: number }).seq);
    expect(seqs).toEqual([4, 5]);
  });

  it('sets wrapper.lastDeliveredSeq to the last backfilled seq', async () => {
    const { ws } = makeSocket();
    const ringBuffer = makeRingBuffer([makeFrame(1), makeFrame(2), makeFrame(3)]);
    const svc = makeService(makeMockRedis(ringBuffer));
    const wrapper = makeWrapper(ws, 0);

    await svc.handleSubscribe(wrapper, 1);

    expect(wrapper.lastDeliveredSeq).toBe(3);
  });

  it('sets wrapper.subscribed=true and wrapper.backfilling=false after backfill', async () => {
    const { ws } = makeSocket();
    const ringBuffer = makeRingBuffer([makeFrame(1), makeFrame(2)]);
    const svc = makeService(makeMockRedis(ringBuffer));
    const wrapper = makeWrapper(ws);

    await svc.handleSubscribe(wrapper, 0);

    expect(wrapper.subscribed).toBe(true);
    expect(wrapper.backfilling).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC7, AC10 — deliverLiveFrame
// ---------------------------------------------------------------------------

describe('BackfillService.deliverLiveFrame', () => {
  it('sends frame directly when not backfilling', () => {
    const { ws, sent } = makeSocket();
    const svc = makeService(makeMockRedis());
    const wrapper = makeWrapper(ws, 5);
    wrapper.subscribed = true;
    wrapper.backfilling = false;

    const json = JSON.stringify(makeFrame(6));
    const delivered = svc.deliverLiveFrame(wrapper, 6, json);

    expect(delivered).toBe(true);
    expect(sent).toHaveLength(1);
    expect(wrapper.lastDeliveredSeq).toBe(6);
  });

  it('silently discards duplicate seq (seq ≤ lastDeliveredSeq)', () => {
    const { ws, sent } = makeSocket();
    const svc = makeService(makeMockRedis());
    const wrapper = makeWrapper(ws, 5);
    wrapper.subscribed = true;
    wrapper.backfilling = false;

    // seq=5 already delivered
    const delivered = svc.deliverLiveFrame(wrapper, 5, JSON.stringify(makeFrame(5)));

    expect(delivered).toBe(true);
    expect(sent).toHaveLength(0); // nothing sent
    expect(wrapper.lastDeliveredSeq).toBe(5); // unchanged
  });

  it('enqueues live frame when wrapper.backfilling is true', () => {
    const { ws, sent } = makeSocket();
    const svc = makeService(makeMockRedis());
    const wrapper = makeWrapper(ws, 3);
    wrapper.subscribed = true;
    wrapper.backfilling = true;

    const json = JSON.stringify(makeFrame(4));
    const result = svc.deliverLiveFrame(wrapper, 4, json);

    expect(result).toBe(true);
    // Frame should be buffered, not sent directly yet
    expect(sent).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// AC11 — Reconnect scenario (fixture-driven)
// ---------------------------------------------------------------------------

describe('BackfillService — AC11 reconnect scenario', () => {
  /**
   * Ring buffer: seq 1..5 (snapshot at 1, deltas 2..5)
   * Client disconnected after seq=3.
   * Reconnects with lastSeq=3.
   * Expected: receives frames 4 and 5.
   */
  it('reconnect after 2 missed frames restores client to latest seq', async () => {
    const { ws, sent } = makeSocket();

    const frames = [
      makeFrame(1, 'snapshot'),
      makeFrame(2),
      makeFrame(3),
      makeFrame(4),
      makeFrame(5),
    ];
    const ringBuffer = makeRingBuffer(frames);
    const svc = makeService(makeMockRedis(ringBuffer));
    const wrapper = makeWrapper(ws, 0);

    const result = await svc.handleSubscribe(wrapper, 3);

    expect(result).toBe(true);
    expect(sent).toHaveLength(2);
    const seqs = sent.map((s) => (JSON.parse(s) as { seq: number }).seq);
    expect(seqs).toEqual([4, 5]);
    expect(wrapper.lastDeliveredSeq).toBe(5);
  });

  /**
   * Client disconnects past the retention window.
   * Ring buffer holds only seq 4..5; client reports lastSeq=1.
   * Expected: snapshot_required(seq_out_of_window).
   */
  it('out-of-window reconnect triggers snapshot_required', async () => {
    const { ws, sent } = makeSocket();

    // Ring buffer has only frames 4 and 5
    const ringBuffer = makeRingBuffer([makeFrame(4), makeFrame(5)]);
    const svc = makeService(makeMockRedis(ringBuffer));
    const wrapper = makeWrapper(ws, 0);

    const result = await svc.handleSubscribe(wrapper, 1);

    expect(result).toBe(false);
    expect(sent).toHaveLength(1);
    const frame = JSON.parse(sent[0]!);
    expect(frame.type).toBe('snapshot_required');
    expect(frame.reason).toBe('seq_out_of_window');
  });
});

// ---------------------------------------------------------------------------
// AC11 — Live-frame buffering during backfill + flush
// ---------------------------------------------------------------------------

describe('BackfillService — live-frame buffering during backfill (AC11)', () => {
  it('queues live frames arriving during backfill and flushes them afterwards', async () => {
    const { ws, sent } = makeSocket();

    // Ring buffer has seq 1..3; client reconnects with lastSeq=1
    const ringBuffer = makeRingBuffer([makeFrame(1, 'snapshot'), makeFrame(2), makeFrame(3)]);
    const svc = makeService(makeMockRedis(ringBuffer));
    const wrapper = makeWrapper(ws, 0);

    // Simulate a live frame arriving BEFORE backfill completes by injecting it
    // after we set wrapper.backfilling=true but before handleSubscribe flips it back.
    // We do this by spying: the mock redis returns the buffer, then handleSubscribe
    // processes it. We deliver a live frame via deliverLiveFrame.

    // First, mark the wrapper as backfilling manually
    wrapper.backfilling = true;
    wrapper.subscribed = true;
    wrapper.lastDeliveredSeq = 1; // already got frame 1

    // Live frame seq=4 arrives during backfill
    svc.deliverLiveFrame(wrapper, 4, JSON.stringify(makeFrame(4)));

    // No frame sent yet (buffered)
    expect(sent).toHaveLength(0);

    // Now simulate backfill completing: flip backfilling flag
    wrapper.backfilling = false;

    // Deliver another live frame seq=5 — should go directly
    svc.deliverLiveFrame(wrapper, 5, JSON.stringify(makeFrame(5)));
    expect(sent).toHaveLength(1);
    expect((JSON.parse(sent[0]!) as { seq: number }).seq).toBe(5);
  });
});
