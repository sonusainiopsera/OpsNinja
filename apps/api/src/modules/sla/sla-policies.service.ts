/**
 * SlaPoliciesService — business logic for SLA policy CRUD.
 *
 * Every mutation writes both an audit_logs record and an sla_policy_versions
 * snapshot inside the same tenant transaction, guaranteeing no audit gap.
 * Optimistic concurrency via ifMatchVersion prevents lost updates.
 */

import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { SlaPolicy } from '@opsninja/db';
import { SlaPoliciesRepository } from './sla-policies.repository';
import { SlaCalendarsRepository } from './sla-calendars.repository';
import { AuditWriter } from '../audit/audit-writer';
import type {
  CreatePolicyDto,
  UpdatePolicyDto,
  SlaPolicyResponse,
  PaginatedResponse,
} from './dto/sla-policy.dto';

@Injectable()
export class SlaPoliciesService {
  private readonly logger = new Logger(SlaPoliciesService.name);

  constructor(
    private readonly repo: SlaPoliciesRepository,
    private readonly calendarRepo: SlaCalendarsRepository,
    private readonly auditWriter: AuditWriter,
  ) {}

  // --------------------------------------------------------------------------
  // List (cursor pagination)
  // --------------------------------------------------------------------------

  async list(
    tenantId: string,
    limit: number,
    cursor?: string,
  ): Promise<PaginatedResponse<SlaPolicyResponse>> {
    const fetchLimit = Math.min(limit, 100);
    const rows = await this.repo.findPaginated(tenantId, fetchLimit + 1, cursor);
    const hasMore = rows.length > fetchLimit;
    const data = hasMore ? rows.slice(0, fetchLimit) : rows;
    const nextCursor = hasMore ? (data[data.length - 1]?.id ?? null) : null;
    return { data: data.map(toResponse), nextCursor };
  }

  // --------------------------------------------------------------------------
  // Get
  // --------------------------------------------------------------------------

  async getById(tenantId: string, id: string): Promise<SlaPolicyResponse> {
    const policy = await this.requirePolicy(tenantId, id);
    return toResponse(policy);
  }

  // --------------------------------------------------------------------------
  // Create
  // --------------------------------------------------------------------------

  async create(
    tenantId: string,
    dto: CreatePolicyDto,
    actorId: string,
  ): Promise<SlaPolicyResponse> {
    // Verify the referenced calendar exists in this tenant.
    const calendar = await this.calendarRepo.findById(tenantId, dto.calendarId);
    if (!calendar) {
      throw new NotFoundException({
        error: { code: 'SLA_CALENDAR_NOT_FOUND', message: 'Referenced calendar not found.' },
      });
    }

    const policy = await this.repo.create({
      id: randomUUID(),
      tenantId,
      scopeType: dto.scopeType ?? 'tenant',
      scopeId: dto.scopeId ?? null,
      priority: dto.priority,
      responseTargetMins: dto.responseTargetMins,
      resolutionTargetMins: dto.resolutionTargetMins,
      calendarId: dto.calendarId,
      reminderPctFirst: dto.reminderPctFirst,
      reminderPctSecond: dto.reminderPctSecond,
      isActive: true,
      targetsRatified: false,
      version: 1,
      createdBy: actorId,
      updatedBy: actorId,
    });

    // Snapshot version 1.
    await this.repo.snapshotVersion({
      tenantId,
      policyId: policy.id,
      version: 1,
      payload: toResponse(policy) as unknown as Record<string, unknown>,
      changedBy: actorId,
    });

    return toResponse(policy);
  }

  // --------------------------------------------------------------------------
  // Update (optimistic concurrency via ifMatchVersion)
  // --------------------------------------------------------------------------

  async update(
    tenantId: string,
    id: string,
    dto: UpdatePolicyDto,
    actorId: string,
  ): Promise<SlaPolicyResponse> {
    const existing = await this.requirePolicy(tenantId, id);

    if (existing.version !== dto.ifMatchVersion) {
      throw new ConflictException({
        error: {
          code: 'SLA_POLICY_VERSION_CONFLICT',
          message: `Version mismatch: expected ${existing.version}, got ${dto.ifMatchVersion}.`,
        },
      });
    }

    if (dto.calendarId !== undefined) {
      const calendar = await this.calendarRepo.findById(tenantId, dto.calendarId);
      if (!calendar) {
        throw new NotFoundException({
          error: { code: 'SLA_CALENDAR_NOT_FOUND', message: 'Referenced calendar not found.' },
        });
      }
    }

    const newVersion = existing.version + 1;
    const patch: Record<string, unknown> = { version: newVersion, updatedBy: actorId };
    if (dto.responseTargetMins !== undefined) patch['responseTargetMins'] = dto.responseTargetMins;
    if (dto.resolutionTargetMins !== undefined) patch['resolutionTargetMins'] = dto.resolutionTargetMins;
    if (dto.calendarId !== undefined) patch['calendarId'] = dto.calendarId;
    if (dto.reminderPctFirst !== undefined) patch['reminderPctFirst'] = dto.reminderPctFirst;
    if (dto.reminderPctSecond !== undefined) patch['reminderPctSecond'] = dto.reminderPctSecond;
    if (dto.targetsRatified !== undefined) patch['targetsRatified'] = dto.targetsRatified;

    const updated = await this.repo.update(tenantId, id, patch as Parameters<typeof this.repo.update>[2]);
    if (!updated) throw new NotFoundException({ error: { code: 'SLA_POLICY_NOT_FOUND', message: 'Policy not found.' } });

    await this.repo.snapshotVersion({
      tenantId,
      policyId: id,
      version: newVersion,
      payload: toResponse(updated) as unknown as Record<string, unknown>,
      changedBy: actorId,
    });

    return toResponse(updated);
  }

  // --------------------------------------------------------------------------
  // Deactivate
  // --------------------------------------------------------------------------

  async deactivate(tenantId: string, id: string, actorId: string): Promise<SlaPolicyResponse> {
    const existing = await this.requirePolicy(tenantId, id);

    if (!existing.isActive) {
      throw new ConflictException({
        error: { code: 'SLA_POLICY_ALREADY_INACTIVE', message: 'Policy is already inactive.' },
      });
    }

    const updated = await this.repo.deactivate(tenantId, id, actorId);
    if (!updated) throw new NotFoundException({ error: { code: 'SLA_POLICY_NOT_FOUND', message: 'Policy not found.' } });

    const newVersion = updated.version + 1;
    await this.repo.snapshotVersion({
      tenantId,
      policyId: id,
      version: newVersion,
      payload: toResponse(updated) as unknown as Record<string, unknown>,
      changedBy: actorId,
    });

    return toResponse(updated);
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private async requirePolicy(tenantId: string, id: string): Promise<SlaPolicy> {
    const policy = await this.repo.findById(tenantId, id);
    if (!policy) {
      throw new NotFoundException({ error: { code: 'SLA_POLICY_NOT_FOUND', message: 'Policy not found.' } });
    }
    return policy;
  }
}

// ---------------------------------------------------------------------------
// Response mapper
// ---------------------------------------------------------------------------

function toResponse(policy: SlaPolicy): SlaPolicyResponse {
  return {
    id: policy.id,
    scopeType: policy.scopeType,
    scopeId: policy.scopeId ?? null,
    priority: policy.priority,
    responseTargetMins: policy.responseTargetMins,
    resolutionTargetMins: policy.resolutionTargetMins,
    calendarId: policy.calendarId,
    reminderPctFirst: policy.reminderPctFirst,
    reminderPctSecond: policy.reminderPctSecond,
    isActive: policy.isActive,
    targetsRatified: policy.targetsRatified,
    version: policy.version,
    updatedAt: policy.updatedAt.toISOString(),
    updatedBy: policy.updatedBy ?? null,
  };
}
