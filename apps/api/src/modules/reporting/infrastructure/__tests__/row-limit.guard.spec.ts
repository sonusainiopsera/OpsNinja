import { RowLimitGuard } from '../guards/row-limit.guard';
import { RowLimitExceededError, ROW_CAP, ROW_CAP_LIMIT } from '../reporting-errors';

function makeRows(count: number): { id: number }[] {
  return Array.from({ length: count }, (_, i) => ({ id: i }));
}

describe('RowLimitGuard', () => {
  let guard: RowLimitGuard;

  beforeEach(() => {
    guard = new RowLimitGuard();
  });

  it('passes cap limit (ROW_CAP_LIMIT = 500001) to the query builder', async () => {
    const spy = jest.fn().mockResolvedValue([]);
    await guard.execute(spy, 'trace-1');
    expect(spy).toHaveBeenCalledWith(ROW_CAP_LIMIT);
  });

  it('returns the result unchanged when below cap', async () => {
    const rows = makeRows(10);
    const result = await guard.execute(async () => rows, 'trace-2');
    expect(result).toStrictEqual(rows);
  });

  it('returns result unchanged at exactly ROW_CAP rows (boundary: permitted)', async () => {
    const rows = makeRows(ROW_CAP);
    const result = await guard.execute(async () => rows, 'trace-3');
    expect(result).toHaveLength(ROW_CAP);
  });

  it('throws RowLimitExceededError when result is ROW_CAP + 1 rows (boundary: exceeded)', async () => {
    const rows = makeRows(ROW_CAP + 1);
    await expect(guard.execute(async () => rows, 'trace-4')).rejects.toBeInstanceOf(
      RowLimitExceededError,
    );
  });

  it('includes the correct error code on RowLimitExceededError', async () => {
    const rows = makeRows(ROW_CAP + 1);
    await expect(guard.execute(async () => rows, 'trace-5')).rejects.toMatchObject({
      code: 'REPORT_ROW_LIMIT_EXCEEDED',
    });
  });

  it('RowLimitExceededError carries the traceId', async () => {
    const rows = makeRows(ROW_CAP + 1);
    let err: RowLimitExceededError | undefined;
    try {
      await guard.execute(async () => rows, 'trace-my-id');
    } catch (e) {
      err = e as RowLimitExceededError;
    }
    expect(err?.traceId).toBe('trace-my-id');
  });

  it('propagates errors from the query builder without wrapping them', async () => {
    const boom = new Error('db exploded');
    await expect(
      guard.execute(async () => {
        throw boom;
      }, 'trace-6'),
    ).rejects.toBe(boom);
  });

  it('handles empty result sets correctly', async () => {
    const result = await guard.execute(async () => [], 'trace-7');
    expect(result).toHaveLength(0);
  });
});
