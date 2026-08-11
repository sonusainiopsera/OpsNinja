/**
 * OrganizationAuditController — WO-030.
 *
 * Read-only audit history surface scoped to a single organization.
 * All routes live under /api/v1/organizations/:orgId/audit.
 *
 * Endpoint map:
 *   GET /api/v1/organizations/:orgId/audit
 *     Cursor-paginated list of audit entries for this organization.
 *     Supports filters: operation (mapped to action), actorId, from, to.
 *     Backed by AuditQueryService (read replica).
 *
 *   GET /api/v1/organizations/:orgId/audit/export
 *     Streams a CSV of audit entries with the same filter set applied.
 *     Returns 422 AUDIT_EXPORT_TOO_LARGE when the result exceeds EXPORT_ROW_CAP.
 *
 * RBAC:
 *   audit:read   → GET list
 *   audit:export → GET export
 *
 * Response shape (list):
 *   200 { data: [AuditEntryDto], nextCursor, traceId }
 *
 * Response shape (export):
 *   200  Content-Type: text/csv  (streamed)
 *   422  { error: { code: 'AUDIT_EXPORT_TOO_LARGE', message, details, traceId } }
 */

import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  Res,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { randomUUID } from 'crypto';

import { RequirePermission } from '../../../common/auth/require-permission.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { getPrincipalContext } from '../../../observability/request-context';
import { OrganizationsRepository } from '../organizations.repository';
import { AuditQueryService, type AuditLogRow } from '../../audit/audit-query.service';
import { AuditQuerySchema, type AuditQueryDto } from '../../audit/dto/audit-query.dto';
import { buildDiffEntries } from './org-audit-diff';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum rows returned in a single CSV export.
 * Callers exceeding this limit receive a 422 with guidance to narrow the
 * date range.  Documented in the API contract and tested.
 */
export const AUDIT_EXPORT_ROW_CAP = 10_000;

// ---------------------------------------------------------------------------
// Org-scoped query DTO (subset of AuditQuerySchema — no resourceType/resourceId,
// those are fixed to 'organization'/{orgId} by the controller)
// ---------------------------------------------------------------------------

const OrgAuditQuerySchema = z
  .object({
    cursor:    z.string().optional(),
    limit:     z.coerce.number().int().min(1).max(100).default(50),
    from:      z
      .string()
      .datetime({ offset: true })
      .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
      .transform((v) => new Date(v))
      .optional(),
    to:        z
      .string()
      .datetime({ offset: true })
      .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
      .transform((v) => new Date(v))
      .optional(),
    actorId:   z.string().uuid().optional(),
    actorType: z.enum(['staff', 'portal', 'machine']).optional(),
    /** Filter to a specific operation (e.g. 'organization.update'). Mapped to action. */
    operation: z.string().min(1).max(128).optional(),
  })
  .strict();

type OrgAuditQueryDto = z.infer<typeof OrgAuditQuerySchema>;

// ---------------------------------------------------------------------------
// Response shaping
// ---------------------------------------------------------------------------

interface ActorDto {
  id:          string | null;
  type:        string | null;
  displayName: string | null;
}

interface AuditEntryDto {
  id:           string;
  occurredAt:   string;
  actor:        ActorDto;
  operation:    string;
  resourceType: string | null;
  resourceId:   string | null;
  diff:         ReturnType<typeof buildDiffEntries>;
  traceId:      string;
}

function shapeRow(row: AuditLogRow): AuditEntryDto {
  return {
    id:           row.id,
    occurredAt:   row.occurredAt.toISOString(),
    actor: {
      id:          row.actorId,
      type:        row.actorType,
      displayName: row.actorDisplay,
    },
    operation:    row.action ?? row.eventType,
    resourceType: row.resourceType,
    resourceId:   row.resourceId,
    diff:         buildDiffEntries(row.changedFields, row.beforeState, row.afterState),
    traceId:      row.traceId,
  };
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

@Controller('organizations/:orgId/audit')
export class OrganizationAuditController {
  constructor(
    private readonly auditQuery: AuditQueryService,
    private readonly orgRepo:    OrganizationsRepository,
  ) {}

  // --------------------------------------------------------------------------
  // GET /api/v1/organizations/:orgId/audit
  // --------------------------------------------------------------------------

  @Get()
  @RequirePermission('audit:read')
  async listAudit(
    @Param('orgId') orgId: string,
    @Query(new ZodValidationPipe(OrgAuditQuerySchema)) query: OrgAuditQueryDto,
    @Req() req: Request,
  ) {
    const traceId   = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();
    const { tenantId } = getPrincipalContext();

    await this.assertOrgExists(tenantId, orgId);

    // Build an AuditQueryDto pre-filtered to this organization.
    const dto: AuditQueryDto = {
      cursor:       query.cursor,
      limit:        query.limit,
      from:         query.from,
      to:           query.to,
      actorId:      query.actorId,
      actorType:    query.actorType,
      resourceType: 'organization',
      resourceId:   orgId,
      // 'operation' in org-audit maps to 'action' in the generic audit filter
      action:       query.operation,
    };

    const page = await this.auditQuery.list(dto);

    return {
      data:       page.data.map(shapeRow),
      nextCursor: page.nextCursor,
      hasMore:    page.hasMore,
      traceId,
    };
  }

  // --------------------------------------------------------------------------
  // GET /api/v1/organizations/:orgId/audit/export
  // --------------------------------------------------------------------------

  @Get('export')
  @RequirePermission('audit:export')
  async exportAudit(
    @Param('orgId') orgId: string,
    @Query(new ZodValidationPipe(OrgAuditQuerySchema)) query: OrgAuditQueryDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();
    const { tenantId } = getPrincipalContext();

    await this.assertOrgExists(tenantId, orgId);

    // Probe row count: fetch cap + 1 to detect overflow.
    const dto: AuditQueryDto = {
      cursor:       undefined,
      limit:        AUDIT_EXPORT_ROW_CAP + 1,
      from:         query.from,
      to:           query.to,
      actorId:      query.actorId,
      actorType:    query.actorType,
      resourceType: 'organization',
      resourceId:   orgId,
      action:       query.operation,
    };

    const page = await this.auditQuery.list(dto);

    if (page.data.length > AUDIT_EXPORT_ROW_CAP) {
      throw new UnprocessableEntityException({
        error: {
          code:    'AUDIT_EXPORT_TOO_LARGE',
          message:
            `The filtered result set exceeds the export row cap of ` +
            `${AUDIT_EXPORT_ROW_CAP.toLocaleString()} rows. ` +
            `Narrow the date range using the 'from' and 'to' parameters and retry.`,
          details: [
            { rowCap: AUDIT_EXPORT_ROW_CAP },
          ],
          traceId,
        },
      });
    }

    // Build and stream CSV.
    const filename = `org-${orgId}-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Header row.
    res.write(
      'id,occurredAt,actorId,actorType,operation,resourceType,resourceId,fields,traceId\r\n',
    );

    // Data rows — streamed one-by-one so memory is bounded.
    for (const row of page.data) {
      const shaped = shapeRow(row);
      const fields = shaped.diff.map((d) => d.field).join(';');
      res.write(
        [
          csvCell(shaped.id),
          csvCell(shaped.occurredAt),
          csvCell(shaped.actor.id ?? ''),
          csvCell(shaped.actor.type ?? ''),
          csvCell(shaped.operation),
          csvCell(shaped.resourceType ?? ''),
          csvCell(shaped.resourceId ?? ''),
          csvCell(fields),
          csvCell(shaped.traceId),
        ].join(',') + '\r\n',
      );
    }

    res.end();
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private async assertOrgExists(tenantId: string, orgId: string): Promise<void> {
    const org = await this.orgRepo.findById(tenantId, orgId);
    if (!org) {
      throw new NotFoundException({
        error: {
          code:    'ORGANIZATION_NOT_FOUND',
          message: `Organization ${orgId} not found.`,
          details: [],
        },
      });
    }
  }
}

/** Escape a CSV cell value per RFC 4180. */
function csvCell(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}
