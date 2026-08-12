/**
 * OrganizationChangeRequestsService — WO-088.
 *
 * Owned by the organizations module. Creates admin-reviewable change requests
 * submitted by portal users, with deduplication so identical pending requests
 * from the same user produce exactly one row.
 *
 * Access: onboarding module calls this via DI; nothing else in the onboarding
 * module touches organization tables directly.
 */

import { Injectable, Logger } from '@nestjs/common';
import { randomUUID }         from 'crypto';
import { eq, and }            from 'drizzle-orm';

import { organizationChangeRequests } from '@opsninja/db';
import type { OrganizationChangeRequest } from '@opsninja/db';
import { TenantRepository }   from '../../data/tenant-repository';

export interface ChangeRequestField {
  key:           string;
  currentValue:  string;
  proposedValue: string;
  note?:         string;
}

export interface CreateChangeRequestInput {
  organizationId:    string;
  requestedByUserId: string;
  fields:            ChangeRequestField[];
}

@Injectable()
export class OrganizationChangeRequestsService extends TenantRepository {
  private readonly logger = new Logger(OrganizationChangeRequestsService.name);

  /**
   * Creates a pending change request, silently returning the existing row when
   * an identical pending request already exists from the same user (AC-10 idempotency).
   */
  async createOrDeduplicate(
    tenantId: string,
    input: CreateChangeRequestInput,
  ): Promise<OrganizationChangeRequest> {
    const fieldsJson = JSON.stringify(input.fields);

    // Check for an identical pending request first
    const existing = await this.tx
      .select()
      .from(organizationChangeRequests)
      .where(
        and(
          eq(organizationChangeRequests.tenantId, tenantId),
          eq(organizationChangeRequests.organizationId, input.organizationId),
          eq(organizationChangeRequests.requestedByUserId, input.requestedByUserId),
          eq(organizationChangeRequests.status, 'pending'),
        ),
      )
      .limit(20); // fetch small batch to check field equality in-app

    const duplicate = existing.find(
      (r) => JSON.stringify(r.fields) === fieldsJson,
    );

    if (duplicate) {
      this.logger.debug('Deduplicated change request — returning existing', {
        tenantId,
        organizationId: input.organizationId,
        existingId: duplicate.id,
      });
      return duplicate;
    }

    const [created] = await this.tx
      .insert(organizationChangeRequests)
      .values({
        id:                  randomUUID(),
        tenantId,
        organizationId:      input.organizationId,
        requestedByUserId:   input.requestedByUserId,
        fields:              input.fields as unknown as Record<string, unknown>[],
        status:              'pending',
        createdAt:           new Date(),
        updatedAt:           new Date(),
      })
      .returning();

    this.logger.log('Organization change request created', {
      tenantId,
      organizationId: input.organizationId,
      requestId:      created!.id,
    });

    return created!;
  }
}
