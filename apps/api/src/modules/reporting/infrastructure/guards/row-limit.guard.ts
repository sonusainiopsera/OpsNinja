/**
 * RowLimitGuard
 *
 * Enforces the 500 000-row cap on reporting query results.
 *
 * The cap is server-side: the guard passes ROW_CAP_LIMIT (500 001) to the
 * query builder as the LIMIT value, so Postgres never transmits more than
 * 500 001 rows over the wire.  The guard then checks client-side whether
 * the result length exceeds ROW_CAP (500 000) and throws RowLimitExceededError
 * if so.
 *
 * Usage:
 *   const rows = await rowLimitGuard.execute(
 *     (limit) => tx.execute(sql`SELECT * FROM tickets LIMIT ${limit}`),
 *     traceId,
 *   );
 */

import { Injectable, Logger } from '@nestjs/common';
import { ROW_CAP, ROW_CAP_LIMIT, RowLimitExceededError } from '../reporting-errors';

@Injectable()
export class RowLimitGuard {
  private readonly logger = new Logger(RowLimitGuard.name);

  /**
   * Executes `queryFn` with the cap limit injected, then checks for overflow.
   *
   * @param queryFn   Async factory that accepts the LIMIT value (500 001) and
   *                  returns the result rows.  Callers MUST use the supplied
   *                  limit as the SQL LIMIT clause.
   * @param traceId   Request trace ID for structured error context.
   * @returns         The result rows (at most ROW_CAP rows).
   * @throws {RowLimitExceededError} When the query would return > ROW_CAP rows.
   */
  async execute<T>(
    queryFn: (capLimit: number) => Promise<T[]>,
    traceId = 'unknown',
  ): Promise<T[]> {
    const rows = await queryFn(ROW_CAP_LIMIT);

    if (rows.length > ROW_CAP) {
      this.logger.warn('Row cap exceeded', {
        cap: ROW_CAP,
        returned: rows.length,
        traceId,
      });
      throw new RowLimitExceededError(traceId);
    }

    return rows;
  }
}
