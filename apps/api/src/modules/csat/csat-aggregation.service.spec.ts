import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CsatAggregationService } from './csat-aggregation.service';
import type { TenantScopedReplicaRunner } from '../reporting/infrastructure/tenant-scoped-replica.runner';

describe('CsatAggregationService', () => {
  let service: CsatAggregationService;
  let mockRunner: { run: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockRunner = { run: vi.fn() };
    service = new CsatAggregationService(mockRunner as unknown as TenantScopedReplicaRunner);
  });

  function makeClient(sentCount: number, responses: Array<{ score: number }>) {
    const sentRow = { sent_count: String(sentCount) };
    const responseRow = {
      response_count: String(responses.length),
      avg_score: responses.length > 0
        ? String(responses.reduce((s, r) => s + r.score, 0) / responses.length)
        : null,
      dist_1: String(responses.filter((r) => r.score === 1).length),
      dist_2: String(responses.filter((r) => r.score === 2).length),
      dist_3: String(responses.filter((r) => r.score === 3).length),
      dist_4: String(responses.filter((r) => r.score === 4).length),
      dist_5: String(responses.filter((r) => r.score === 5).length),
    };

    return {
      query: vi.fn()
        .mockResolvedValueOnce(undefined) // SET LOCAL statement_timeout
        .mockResolvedValueOnce({ rows: [sentRow] }) // sent count query
        .mockResolvedValueOnce({ rows: [responseRow] }), // response aggregation
    };
  }

  it('returns zero-state when no surveys exist', async () => {
    const client = makeClient(0, []);
    mockRunner.run.mockImplementation(async (cb: (c: typeof client) => unknown) => cb(client));

    const result = await service.getSummary({
      from: new Date('2026-01-01'),
      to: new Date('2026-01-31'),
    });

    expect(result).toEqual({
      averageScore: null,
      responseCount: 0,
      sentCount: 0,
      responseRate: 0,
      distribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
    });
  });

  it('computes correct aggregates with responses', async () => {
    const responses = [
      { score: 5 }, { score: 4 }, { score: 5 }, { score: 3 }, { score: 5 },
    ];
    const client = makeClient(10, responses);
    mockRunner.run.mockImplementation(async (cb: (c: typeof client) => unknown) => cb(client));

    const result = await service.getSummary({
      from: new Date('2026-01-01'),
      to: new Date('2026-01-31'),
    });

    expect(result.responseCount).toBe(5);
    expect(result.sentCount).toBe(10);
    expect(result.responseRate).toBeCloseTo(0.5);
    expect(result.distribution['5']).toBe(3);
    expect(result.distribution['4']).toBe(1);
    expect(result.distribution['3']).toBe(1);
    expect(result.distribution['1']).toBe(0);
  });

  it('responseRate is 0 when sentCount is 0 (no division by zero)', async () => {
    const client = makeClient(0, []);
    mockRunner.run.mockImplementation(async (cb: (c: typeof client) => unknown) => cb(client));

    const result = await service.getSummary({
      from: new Date('2026-01-01'),
      to: new Date('2026-01-31'),
    });

    expect(result.responseRate).toBe(0);
  });

  it('sets 30-second statement timeout on replica connection', async () => {
    const client = makeClient(0, []);
    mockRunner.run.mockImplementation(async (cb: (c: typeof client) => unknown) => cb(client));

    await service.getSummary({ from: new Date('2026-01-01'), to: new Date('2026-01-31') });

    const firstCall = vi.mocked(client.query).mock.calls[0][0] as string;
    expect(firstCall).toContain('statement_timeout');
    expect(firstCall).toContain('30000');
  });
});
