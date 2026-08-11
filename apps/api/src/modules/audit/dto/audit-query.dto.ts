/**
 * Audit query DTO — WO-096.
 *
 * Strict Zod schema that rejects unknown properties, enforces a configurable
 * maximum date-range window, and caps limit at 100. Used by AuditController
 * and AuditQueryService.
 *
 * Security: unknown fields are rejected (z.strict()) so a user cannot inject
 * unexpected predicates. Filter values are never interpolated into SQL strings;
 * they are mapped through an allow-list inside AuditFilterMapper.
 */

import { z } from 'zod';
import { UnprocessableEntityException } from '@nestjs/common';

const ISO_DATE = z
  .string()
  .datetime({ offset: true })
  .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
  .transform((v) => new Date(v));

/** Maximum date-range window in days (configurable via env). */
export const AUDIT_MAX_WINDOW_DAYS = parseInt(
  process.env['AUDIT_MAX_WINDOW_DAYS'] ?? '365',
  10,
);

export const AuditQuerySchema = z
  .object({
    /** Opaque keyset cursor from a previous response. */
    cursor: z.string().optional(),
    /** Max records to return per page (1–100). */
    limit: z.coerce.number().int().min(1).max(100).default(50),
    /** Inclusive lower bound on occurred_at (maps to created_at). */
    from: ISO_DATE.optional(),
    /** Inclusive upper bound on occurred_at (maps to created_at). */
    to: ISO_DATE.optional(),
    /** Filter to a single actor UUID. */
    actorId: z.string().uuid().optional(),
    /** Filter to a single actor kind (staff | portal | machine). */
    actorType: z.enum(['staff', 'portal', 'machine']).optional(),
    /** Filter to a resource type (e.g. 'ticket', 'webhook_endpoint'). */
    resourceType: z.string().min(1).max(64).optional(),
    /** Filter to a specific resource UUID. */
    resourceId: z.string().uuid().optional(),
    /** Filter to an action (e.g. 'create', 'update'). */
    action: z.string().min(1).max(64).optional(),
    /** Filter to records whose changed_fields array contains this dotted path. */
    changedField: z.string().min(1).max(128).optional(),
  })
  .strict()
  .refine(
    (v) => {
      if (!v.from || !v.to) return true;
      const diff = (v.to.getTime() - v.from.getTime()) / (1000 * 60 * 60 * 24);
      return diff <= AUDIT_MAX_WINDOW_DAYS;
    },
    (v) => ({
      message: `Date range exceeds the maximum allowed window of ${AUDIT_MAX_WINDOW_DAYS} days. ` +
        `Narrow the range using the 'from' and 'to' parameters.`,
      path: ['to'],
    }),
  );

export type AuditQueryDto = z.infer<typeof AuditQuerySchema>;

/**
 * Guard that throws 422 when the date range exceeds the maximum window.
 * Called by AuditQueryService before executing the query.
 */
export function assertWindowWithinLimit(from: Date | undefined, to: Date | undefined): void {
  if (!from || !to) return;
  const diffDays = (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24);
  if (diffDays > AUDIT_MAX_WINDOW_DAYS) {
    throw new UnprocessableEntityException({
      error: {
        code: 'AUDIT_WINDOW_TOO_WIDE',
        message:
          `Date range of ${Math.ceil(diffDays)} days exceeds the maximum ` +
          `allowed window of ${AUDIT_MAX_WINDOW_DAYS} days. ` +
          `Narrow the range using 'from' and 'to' parameters.`,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Verify DTO
// ---------------------------------------------------------------------------

export const AuditVerifySchema = z
  .object({
    from: ISO_DATE,
    to:   ISO_DATE,
  })
  .strict()
  .refine(
    (v) => v.from <= v.to,
    { message: 'from must be before to', path: ['from'] },
  );

export type AuditVerifyDto = z.infer<typeof AuditVerifySchema>;

// ---------------------------------------------------------------------------
// Export DTO
// ---------------------------------------------------------------------------

export const AuditExportSchema = z
  .object({
    format: z.enum(['csv', 'json']).default('csv'),
    filters: z.object({
      from:          ISO_DATE.optional(),
      to:            ISO_DATE.optional(),
      actorId:       z.string().uuid().optional(),
      actorType:     z.enum(['staff', 'portal', 'machine']).optional(),
      resourceType:  z.string().min(1).max(64).optional(),
      resourceId:    z.string().uuid().optional(),
      action:        z.string().min(1).max(64).optional(),
      changedField:  z.string().min(1).max(128).optional(),
    }).strict().optional(),
  })
  .strict();

export type AuditExportDto = z.infer<typeof AuditExportSchema>;
