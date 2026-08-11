import { CsatAggregationService, CsatAggregationResult } from '../csat-aggregation.service';

function makeReplicaRunner(sentRows: unknown, responseRows: unknown) {
  return {
    run: jest.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      let callCount = 0;
      const tx = {
        select: jest.fn().mockImplementation(() => ({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockImplementation(() =>
                Promise.resolve(callCount++ === 0 ? sentRows : []),
              ),
            }),
          }),
        })),
      };
      // We need two selects: sentCount then responseResult
      // Use a more explicit mock
      const selectCalls: unknown[][] = [sentRows as unknown[], responseRows as unknown[]];
      let selectIdx = 0;
      const txFull = {
        select: jest.fn().mockImplementation(() => ({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue(
              Promise.resolve(selectCalls[selectIdx++] ?? []),
            ),
          }),
        })),
      };
      void tx;
      return fn(txFull);
    }),
  };
}

describe('CsatAggregationService', () => {
  const tenantId = 'tenant-abc';
  const from = new Date('2025-01-01T00:00:00Z');
  const to = new Date('2025-12-31T23:59:59Z');

  it('returns zero-state when no surveys exist', async () => {
    const runner = makeReplicaRunner([{ count: '0' }], [{ count: '0', avgScore: null, d1: '0', d2: '0', d3: '0', d4: '0', d5: '0' }]);
    const service = new CsatAggregationService(runner as never);
    const result = await service.getSummary(tenantId, from, to);
    expect(result.sentCount).toBe(0);
    expect(result.responseCount).toBe(0);
    expect(result.averageScore).toBeNull();
    expect(result.responseRate).toBe(0);
    expect(result.distribution).toEqual({ '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 });
  });

  it('computes response rate correctly', async () => {
    const runner = makeReplicaRunner(
      [{ count: '10' }],
      [{ count: '4', avgScore: '4.25', d1: '0', d2: '0', d3: '1', d4: '2', d5: '1' }],
    );
    const service = new CsatAggregationService(runner as never);
    const result = await service.getSummary(tenantId, from, to);
    expect(result.sentCount).toBe(10);
    expect(result.responseCount).toBe(4);
    expect(result.responseRate).toBeCloseTo(0.4, 5);
    expect(result.averageScore).toBeCloseTo(4.25, 2);
  });

  it('returns correct distribution', async () => {
    const runner = makeReplicaRunner(
      [{ count: '5' }],
      [{ count: '5', avgScore: '3.0', d1: '1', d2: '1', d3: '1', d4: '1', d5: '1' }],
    );
    const service = new CsatAggregationService(runner as never);
    const result: CsatAggregationResult = await service.getSummary(tenantId, from, to);
    expect(result.distribution['1']).toBe(1);
    expect(result.distribution['5']).toBe(1);
  });
});
