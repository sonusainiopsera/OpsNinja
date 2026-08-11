/**
 * Row-limit guard for reporting queries.
 *
 * Enforces a server-side 500,000-row cap by wrapping the caller's SQL in
 * a subquery and fetching LIMIT 500,001 rows. If exactly 500,001 rows come
 * back the cap has been exceeded and RowLimitExceededError is thrown before
 * any data is returned to the caller.
 *
 * Fetching one row over the cap (rather than exactly the cap) lets us
 * distinguish "exactly at limit" (500,000 → succeeds) from "over limit"
 * (500,001 → fails), satisfying the edge-case requirement.
 *
 * applyRowCapSql() and checkRowCap() are exported as pure functions so they
 * can be unit-tested without a database connection.
 */

import { PoolClient } from 'pg';

import { RowLimitExceededError } from '../reporting-errors';

export const ROW_CAP = 500_000;

export function applyRowCapSql(sql: string): string {
  return `SELECT * FROM (${sql}) AS _row_cap_check_ LIMIT ${ROW_CAP + 1}`;
}

export function checkRowCap<T>(rows: T[]): T[] {
  if (rows.length > ROW_CAP) {
    throw new RowLimitExceededError(ROW_CAP);
  }
  return rows;
}

export async function executeWithRowCap<T extends Record<string, unknown>>(
  client: PoolClient,
  sql: string,
  params: unknown[],
): Promise<T[]> {
  const cappedSql = applyRowCapSql(sql);
  const result = await client.query<T>(cappedSql, params as string[]);
  return checkRowCap(result.rows);
}
