import {
  Injectable,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { SlaPoliciesRepository } from './sla-policies.repository';
import { AuditWriter } from '../../common/audit/audit-writer';
import { RequestContextStore } from '../../observability/request-context';
import { assertFound } from '../../common/errors/not-found';
import type {
  CreatePolicyDto,
  UpdatePolicyDto,
  PolicyResponse,
  PagedResponse,
  ListQueryDto,
} from './dto/sla.dto';

function toPolicyResponse(p: {
  id: string;
  scopeType: string;
  scopeId: string | null;
  priority: string;
  responseTargetMins: number;
  resolutionTargetMins: number;
  calendarId: string;
  reminderPctFirst: number;
  reminderPctSecond: number;
  isActive: boolean;
  targetsRatified: boolean;
  version: number;
  updatedAt: Date;
  updatedBy: string;
}): PolicyResponse {
  return {
    id: p.id,
    scope_type: p.scopeType,
    scope_id: p.scopeId ?? null,
    priority: p.priority,
    response_target_mins: p.responseTargetMins,
    resolution_target_mins: p.resolutionTargetMins,
    calendar_id: p.calendarId,
    reminder_pct_first: p.reminderPctFirst,
    reminder_pct_second: p.reminderPctSecond,
    is_active: p.isActive,
    targets_ratified: p.targetsRatified,
    version: p.version,
    updated_at: p.updatedAt.toISOString(),
    updated_by: p.updatedBy,
  };
}

@Injectable()
export class SlaPoliciesService {
  constructor(
    private readonly repo: SlaPoliciesRepository,
    private readonly auditWriter: AuditWriter,
  ) {}

  async listPolicies(query: ListQueryDto): Promise<PagedResponse<PolicyResponse>> {
    const rows = await this.repo.findAll(query.cursor, query.limit);
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const nextCursor = hasMore ? page[page.length - 1]!.id : null;
    return { data: page.map(toPolicyResponse), next_cursor: nextCursor };
  }

  async getPolicy(id: string): Promise<PolicyResponse> {
    const policy = await this.repo.findById(id);
    assertFound(policy, 'SlaPolicy');
    return toPolicyResponse(policy);
  }

  async createPolicy(dto: CreatePolicyDto): Promise<PolicyResponse> {
    const { userId, tenantId } = RequestContextStore.getPrincipal();

    const conflict = await this.repo.findActiveByScopeAndPriority(
      dto.scope_type ?? 'tenant',
      dto.scope_id ?? null,
      dto.priority,
    );
    if (conflict) {
      throw new ConflictException({
        code: 'SLA_POLICY_DUPLICATE_PRIORITY',
        message: `An active policy for priority ${dto.priority} already exists in this scope.`,
      });
    }

    const policy = await this.repo.create({
      tenantId,
      scopeType: (dto.scope_type ?? 'tenant') as 'tenant' | 'organization' | 'ticket_type',
      scopeId: dto.scope_id ?? null,
      priority: dto.priority as 'P1' | 'P2' | 'P3' | 'P4',
      responseTargetMins: dto.response_target_mins,
      resolutionTargetMins: dto.resolution_target_mins,
      calendarId: dto.calendar_id,
      reminderPctFirst: dto.reminder_pct_first,
      reminderPctSecond: dto.reminder_pct_second,
      isActive: true,
      targetsRatified: false,
      version: 1,
      createdBy: userId,
      updatedBy: userId,
    });

    // Write version snapshot
    await this.repo.createVersion({
      tenantId,
      policyId: policy.id,
      version: 1,
      payload: { ...dto },
      changedBy: userId,
    });

    await this.auditWriter.append({
      action: 'sla_policy.created',
      resourceType: 'sla_policy',
      resourceId: policy.id,
      afterState: toPolicyResponse(policy) as unknown as Record<string, unknown>,
      forceEmit: true,
    });

    return toPolicyResponse(policy);
  }

  async updatePolicy(id: string, dto: UpdatePolicyDto): Promise<PolicyResponse> {
    const { userId, tenantId } = RequestContextStore.getPrincipal();

    const policy = await this.repo.findById(id);
    assertFound(policy, 'SlaPolicy');

    if (!policy.isActive) {
      throw new UnprocessableEntityException({
        code: 'SLA_POLICY_INACTIVE',
        message: 'Cannot update an inactive policy.',
      });
    }

    // Optimistic concurrency
    if (dto.if_match_version !== policy.version) {
      throw new ConflictException({
        code: 'SLA_POLICY_VERSION_MISMATCH',
        message: `Version mismatch: expected ${policy.version}, got ${dto.if_match_version}.`,
      });
    }

    // Check uniqueness if scope/priority changing
    const newPriority = (dto.priority ?? policy.priority) as string;
    const newScopeType = dto.scope_type ?? policy.scopeType;
    const newScopeId = 'scope_id' in dto ? (dto.scope_id ?? null) : policy.scopeId;

    if (
      newPriority !== policy.priority ||
      newScopeType !== policy.scopeType ||
      newScopeId !== policy.scopeId
    ) {
      const conflict = await this.repo.findActiveByScopeAndPriority(newScopeType, newScopeId, newPriority);
      if (conflict && conflict.id !== id) {
        throw new ConflictException({
          code: 'SLA_POLICY_DUPLICATE_PRIORITY',
          message: `An active policy for priority ${newPriority} already exists in this scope.`,
        });
      }
    }

    const nextVersion = policy.version + 1;

    const updated = await this.repo.update(id, {
      scopeType: dto.scope_type as 'tenant' | 'organization' | 'ticket_type' | undefined,
      scopeId: 'scope_id' in dto ? (dto.scope_id ?? null) : undefined,
      priority: dto.priority as 'P1' | 'P2' | 'P3' | 'P4' | undefined,
      responseTargetMins: dto.response_target_mins,
      resolutionTargetMins: dto.resolution_target_mins,
      calendarId: dto.calendar_id,
      reminderPctFirst: dto.reminder_pct_first,
      reminderPctSecond: dto.reminder_pct_second,
      version: nextVersion,
      updatedBy: userId,
    });
    assertFound(updated, 'SlaPolicy');

    // Write version snapshot
    await this.repo.createVersion({
      tenantId,
      policyId: id,
      version: nextVersion,
      payload: { ...dto },
      changedBy: userId,
    });

    await this.auditWriter.append({
      action: 'sla_policy.updated',
      resourceType: 'sla_policy',
      resourceId: id,
      beforeState: toPolicyResponse(policy) as unknown as Record<string, unknown>,
      afterState: toPolicyResponse(updated) as unknown as Record<string, unknown>,
      forceEmit: true,
    });

    return toPolicyResponse(updated);
  }

  async deactivatePolicy(id: string): Promise<PolicyResponse> {
    const { userId } = RequestContextStore.getPrincipal();

    const policy = await this.repo.findById(id);
    assertFound(policy, 'SlaPolicy');

    if (!policy.isActive) {
      throw new ConflictException({
        code: 'SLA_POLICY_ALREADY_INACTIVE',
        message: 'Policy is already inactive.',
      });
    }

    const updated = await this.repo.deactivate(id, userId);
    assertFound(updated, 'SlaPolicy');

    await this.auditWriter.append({
      action: 'sla_policy.deactivated',
      resourceType: 'sla_policy',
      resourceId: id,
      afterState: { id, is_active: false },
      forceEmit: true,
    });

    return toPolicyResponse(updated);
  }
}
