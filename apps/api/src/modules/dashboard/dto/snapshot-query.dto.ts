/**
 * Snapshot query DTO — WO-068.
 *
 * Strict Zod schema: unknown properties are rejected with 400 so the client
 * always knows exactly which query params are accepted.
 */

import { z } from 'zod';

export const SnapshotQuerySchema = z
  .object({
    /** Maximum breach-risk rows returned. Range [1, 100], default 20. */
    limit: z
      .string()
      .optional()
      .transform((v) => (v === undefined ? 20 : parseInt(v, 10)))
      .pipe(
        z
          .number()
          .int()
          .min(1, 'limit must be at least 1')
          .max(100, 'limit must not exceed 100'),
      ),
    /** Whether to include the activity feed in the response. Default true. */
    includeFeed: z
      .string()
      .optional()
      .transform((v) => v === undefined || v === 'true'),
  })
  .strict();

export type SnapshotQueryDto = z.infer<typeof SnapshotQuerySchema>;
