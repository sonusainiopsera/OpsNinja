/**
 * JiraMappingService — business logic for jira_project_mappings.
 *
 * Responsibilities:
 *  - Validate field_map entries against live Jira createmeta required fields.
 *  - Enforce single-default exclusivity within a transaction (clearDefault → create/update).
 *  - Delegate data access to JiraMappingRepository (which carries @Auditable on writes).
 *
 * All HTTP routes are already inside a tenant-bound transaction opened by
 * TenantContextInterceptor, so clearDefault + create/update execute atomically
 * without an explicit withTenantTransaction wrapper.
 */

import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
  Logger,
} from '@nestjs/common';
import type { JiraProjectMapping } from '@opsninja/db';
import { JiraMappingRepository } from './jira-mapping.repository';
import { JiraMetadataService } from '../metadata/jira-metadata.service';
import type { CreateMappingDto, UpdateMappingDto } from './jira-mapping.schema';

// ---------------------------------------------------------------------------
// Response shape (subset of columns safe to return)
// ---------------------------------------------------------------------------

export interface JiraMappingResponse {
  id: string;
  connectionId: string;
  projectKey: string;
  projectId: string;
  defaultIssueTypeId: string;
  fieldMap: unknown;
  statusMap: unknown;
  syncRules: unknown;
  isDefault: boolean;
  enabled: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedMappingsResponse {
  data: JiraMappingResponse[];
  nextCursor: string | null;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class JiraMappingService {
  private readonly logger = new Logger(JiraMappingService.name);

  constructor(
    private readonly repo: JiraMappingRepository,
    private readonly metadataService: JiraMetadataService,
  ) {}

  // --------------------------------------------------------------------------
  // Create
  // --------------------------------------------------------------------------

  async create(
    tenantId: string,
    userId: string,
    dto: CreateMappingDto,
  ): Promise<JiraMappingResponse> {
    // Validate required Jira fields are covered by the provided fieldMap.
    await this.assertRequiredFieldsCovered(
      tenantId,
      dto.connectionId,
      dto.projectKey,
      dto.defaultIssueTypeId,
      dto.fieldMap.map((f) => f.target.fieldId),
    );

    // Enforce single-default exclusivity — clear before writing.
    if (dto.isDefault) {
      await this.repo.clearDefault(tenantId, dto.connectionId);
    }

    const created = await this.repo.create({
      tenantId,
      connectionId: dto.connectionId,
      projectKey: dto.projectKey,
      projectId: dto.projectId,
      defaultIssueTypeId: dto.defaultIssueTypeId,
      fieldMap: dto.fieldMap as unknown[],
      statusMap: dto.statusMap as unknown[],
      syncRules: dto.syncRules as unknown,
      isDefault: dto.isDefault,
      enabled: dto.enabled,
      createdBy: userId,
    });

    return toResponse(created);
  }

  // --------------------------------------------------------------------------
  // Update
  // --------------------------------------------------------------------------

  async update(
    tenantId: string,
    id: string,
    dto: UpdateMappingDto,
  ): Promise<JiraMappingResponse> {
    const existing = await this.requireMapping(tenantId, id);

    // Merge patch: resolved values are used for validation.
    const resolvedProjectKey = dto.projectKey ?? existing.projectKey;
    const resolvedIssueTypeId = dto.defaultIssueTypeId ?? existing.defaultIssueTypeId;
    const resolvedFieldMap = (dto.fieldMap ?? (existing.fieldMap as Array<{ target: { fieldId: string } }>)) as Array<{ target: { fieldId: string } }>;

    // Validate required Jira fields against the resolved field map.
    await this.assertRequiredFieldsCovered(
      tenantId,
      existing.connectionId,
      resolvedProjectKey,
      resolvedIssueTypeId,
      resolvedFieldMap.map((f) => f.target.fieldId),
    );

    // Enforce single-default exclusivity.
    if (dto.isDefault === true) {
      await this.repo.clearDefault(tenantId, existing.connectionId);
    }

    const updated = await this.repo.update(tenantId, id, {
      projectKey: dto.projectKey,
      projectId: dto.projectId,
      defaultIssueTypeId: dto.defaultIssueTypeId,
      fieldMap: dto.fieldMap as unknown[] | undefined,
      statusMap: dto.statusMap as unknown[] | undefined,
      syncRules: dto.syncRules as unknown,
      isDefault: dto.isDefault,
      enabled: dto.enabled,
    });

    if (!updated) {
      throw new NotFoundException({
        error: { code: 'JIRA_MAPPING_NOT_FOUND', message: 'Jira project mapping not found.' },
      });
    }

    return toResponse(updated);
  }

  // --------------------------------------------------------------------------
  // List
  // --------------------------------------------------------------------------

  async list(
    tenantId: string,
    limit: number,
    cursor?: string,
    connectionId?: string,
  ): Promise<PaginatedMappingsResponse> {
    const fetchLimit = Math.min(limit, 100);
    const rows = await this.repo.findPaginated(tenantId, fetchLimit + 1, cursor, connectionId);
    const hasMore = rows.length > fetchLimit;
    const data = hasMore ? rows.slice(0, fetchLimit) : rows;
    const nextCursor = hasMore ? (data[data.length - 1]?.id ?? null) : null;
    return { data: data.map(toResponse), nextCursor };
  }

  // --------------------------------------------------------------------------
  // Get by ID
  // --------------------------------------------------------------------------

  async getById(tenantId: string, id: string): Promise<JiraMappingResponse> {
    const mapping = await this.requireMapping(tenantId, id);
    return toResponse(mapping);
  }

  // --------------------------------------------------------------------------
  // Delete
  // --------------------------------------------------------------------------

  async delete(tenantId: string, id: string): Promise<void> {
    const deleted = await this.repo.delete(tenantId, id);
    if (!deleted) {
      throw new NotFoundException({
        error: { code: 'JIRA_MAPPING_NOT_FOUND', message: 'Jira project mapping not found.' },
      });
    }
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private async requireMapping(tenantId: string, id: string): Promise<JiraProjectMapping> {
    const mapping = await this.repo.findById(tenantId, id);
    if (!mapping) {
      throw new NotFoundException({
        error: { code: 'JIRA_MAPPING_NOT_FOUND', message: 'Jira project mapping not found.' },
      });
    }
    return mapping;
  }

  /**
   * Validate that all Jira-required fields for the selected issue type are
   * covered by the provided fieldMap target IDs. Throws 422 on violation.
   *
   * If the Jira metadata call fails (network error or rate limit), we propagate
   * the upstream 503 rather than silently allowing an incomplete mapping.
   */
  private async assertRequiredFieldsCovered(
    tenantId: string,
    connectionId: string,
    projectKey: string,
    issueTypeId: string,
    fieldMapTargetIds: string[],
  ): Promise<void> {
    let missing: string[];
    try {
      missing = await this.metadataService.getMissingRequiredFields(
        tenantId,
        connectionId,
        projectKey,
        issueTypeId,
        fieldMapTargetIds,
      );
    } catch (err) {
      // If the metadata API is unavailable, propagate the error (fail-closed).
      this.logger.warn('Could not validate required fields — metadata unavailable', {
        connectionId,
        projectKey,
        issueTypeId,
        error: (err as Error).message,
      });
      throw err;
    }

    if (missing.length > 0) {
      throw new UnprocessableEntityException({
        error: {
          code: 'JIRA_REQUIRED_FIELD_UNMAPPED',
          message:
            'The following Jira-required fields are not covered by the field map. ' +
            'Add a mapping for each listed field ID or set a static value.',
          details: missing,
        },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toResponse(m: JiraProjectMapping): JiraMappingResponse {
  return {
    id: m.id,
    connectionId: m.connectionId,
    projectKey: m.projectKey,
    projectId: m.projectId,
    defaultIssueTypeId: m.defaultIssueTypeId,
    fieldMap: m.fieldMap,
    statusMap: m.statusMap,
    syncRules: m.syncRules,
    isDefault: m.isDefault,
    enabled: m.enabled,
    createdBy: m.createdBy ?? null,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}
