/**
 * ReportDefinitionService — CRUD with sharing-scope visibility and optimistic concurrency.
 *
 * Visibility: private definitions are visible only to their owner.
 * team and tenant definitions are visible to all principals of the tenant.
 *
 * Optimistic concurrency: PATCH requires a `version` field matching the
 * current row version; mismatch returns 409.
 *
 * Cursor pagination: keyset on (createdAt, id) — base64url JSON cursor.
 */

import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { reportDefinitions, type ReportDefinition } from '@opsninja/db';
import { ReportDefinitionsRepository } from '../report-definitions.repository';
import { SharingScopeResolver, type ViewerContext } from './sharing-scope.resolver';
import type {
  CreateReportDefinitionDto,
  UpdateReportDefinitionDto,
} from '../api/dto/report-definition.dto';
import { getPrincipalContext } from '../../../observability/request-context';

export interface PaginatedDefinitions {
  items:      DefinitionSummary[];
  nextCursor: string | null;
}

export interface DefinitionSummary {
  id:           string;
  name:         string;
  description:  string | null;
  chartType:    string | null;
  sharingScope: string;
  version:      number;
  createdBy:    string | null;
  createdAt:    string;
  updatedAt:    string;
}

@Injectable()
export class ReportDefinitionService {
  private readonly logger = new Logger(ReportDefinitionService.name);

  constructor(
    private readonly repo:          ReportDefinitionsRepository,
    private readonly scopeResolver: SharingScopeResolver,
  ) {}

  // --------------------------------------------------------------------------
  // List (cursor-paginated, visibility-filtered)
  // --------------------------------------------------------------------------

  async list(
    tenantId: string,
    viewer: ViewerContext,
    limit: number,
    cursor?: string,
  ): Promise<PaginatedDefinitions> {
    const all = await this.repo.findVisible(tenantId, viewer.userId, cursor, limit + 1);
    const hasMore   = all.length > limit;
    const page      = hasMore ? all.slice(0, limit) : all;
    const nextCursor = hasMore ? encodeCursor(page[page.length - 1]!) : null;
    return { items: page.map(toSummary), nextCursor };
  }

  // --------------------------------------------------------------------------
  // Get by ID (visibility checked — returns 404 for out-of-scope ids)
  // --------------------------------------------------------------------------

  async getById(
    tenantId: string,
    id: string,
    viewer: ViewerContext,
  ): Promise<ReportDefinition> {
    const def = await this.repo.findById(tenantId, id);
    if (!def || !this.scopeResolver.canView(def, viewer)) {
      throw new NotFoundException({
        error: { code: 'REPORT_NOT_FOUND', message: 'Report definition not found.' },
      });
    }
    return def;
  }

  // --------------------------------------------------------------------------
  // Create
  // --------------------------------------------------------------------------

  async create(
    tenantId: string,
    userId: string,
    dto: CreateReportDefinitionDto,
  ): Promise<ReportDefinition> {
    return this.repo.create({
      tenantId,
      name:         dto.name,
      description:  dto.description ?? null,
      metrics:      dto.metrics as unknown[],
      groupBy:      dto.groupBy as unknown[],
      filterAst:    (dto.filterAst ?? null) as unknown,
      chartType:    dto.chartType,
      sharingScope: dto.sharingScope,
      version:      1,
      createdBy:    userId,
    });
  }

  // --------------------------------------------------------------------------
  // Update (optimistic concurrency via version)
  // --------------------------------------------------------------------------

  async update(
    tenantId: string,
    id: string,
    dto: UpdateReportDefinitionDto,
    viewer: ViewerContext,
  ): Promise<ReportDefinition> {
    const def = await this.repo.findById(tenantId, id);
    if (!def || !this.scopeResolver.canView(def, viewer)) {
      throw new NotFoundException({
        error: { code: 'REPORT_NOT_FOUND', message: 'Report definition not found.' },
      });
    }

    // Optimistic concurrency check.
    if (def.version !== dto.version) {
      throw new ConflictException({
        error: {
          code:    'REPORT_VERSION_CONFLICT',
          message: 'This definition was modified by another request. Fetch the latest version and retry.',
          currentVersion: def.version,
        },
      });
    }

    const { version: _version, ...patch } = dto;

    const updated = await this.repo.update(tenantId, id, {
      ...(patch.name         !== undefined && { name:         patch.name }),
      ...(patch.description  !== undefined && { description:  patch.description }),
      ...(patch.metrics      !== undefined && { metrics:      patch.metrics as unknown[] }),
      ...(patch.groupBy      !== undefined && { groupBy:      patch.groupBy as unknown[] }),
      ...(patch.filterAst    !== undefined && { filterAst:    patch.filterAst as unknown }),
      ...(patch.chartType    !== undefined && { chartType:    patch.chartType }),
      ...(patch.sharingScope !== undefined && { sharingScope: patch.sharingScope }),
      version: def.version + 1,
    });

    if (!updated) {
      throw new NotFoundException({
        error: { code: 'REPORT_NOT_FOUND', message: 'Report definition not found.' },
      });
    }
    return updated;
  }

  // --------------------------------------------------------------------------
  // Soft-delete
  // --------------------------------------------------------------------------

  async delete(
    tenantId: string,
    id: string,
    viewer: ViewerContext,
  ): Promise<void> {
    const def = await this.repo.findById(tenantId, id);
    if (!def || !this.scopeResolver.canView(def, viewer)) {
      throw new NotFoundException({
        error: { code: 'REPORT_NOT_FOUND', message: 'Report definition not found.' },
      });
    }
    await this.repo.softDelete(tenantId, id);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toSummary(d: ReportDefinition): DefinitionSummary {
  return {
    id:           d.id,
    name:         d.name,
    description:  d.description ?? null,
    chartType:    d.chartType ?? null,
    sharingScope: d.sharingScope,
    version:      d.version ?? 1,
    createdBy:    d.createdBy ?? null,
    createdAt:    d.createdAt.toISOString(),
    updatedAt:    d.updatedAt.toISOString(),
  };
}

function encodeCursor(def: ReportDefinition): string {
  const payload = JSON.stringify({ createdAt: def.createdAt.toISOString(), id: def.id });
  return Buffer.from(payload).toString('base64url');
}
