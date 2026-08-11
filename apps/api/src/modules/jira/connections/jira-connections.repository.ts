import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { eq, and, gt, lt, asc } from 'drizzle-orm';
import { jiraConnections } from '@opsninja/db';
import { TenantRepository } from '../../../data/tenant-repository';
import type { JiraConnection } from '@opsninja/db';

export interface CreateConnectionParams {
  tenantId: string;
  siteUrl: string;
  cloudId: string;
  authMethod: 'oauth3lo' | 'api_token';
  scopes: string[];
  secretRef: string;
  tokenExpiresAt: Date | null;
  state: 'pending' | 'active' | 'degraded' | 'revoked';
  createdBy: string;
}

export interface UpdateConnectionParams {
  state?: 'pending' | 'active' | 'degraded' | 'revoked';
  scopes?: string[];
  secretRef?: string;
  tokenExpiresAt?: Date | null;
  lastTestedAt?: Date | null;
}

@Injectable()
export class JiraConnectionsRepository extends TenantRepository {
  async create(params: CreateConnectionParams): Promise<JiraConnection> {
    const id = randomUUID();
    const now = new Date();
    const rows = await this.db
      .insert(jiraConnections)
      .values({
        id,
        tenantId: params.tenantId,
        siteUrl: params.siteUrl,
        cloudId: params.cloudId,
        authMethod: params.authMethod,
        scopes: params.scopes,
        secretRef: params.secretRef,
        tokenExpiresAt: params.tokenExpiresAt,
        state: params.state,
        lastTestedAt: null,
        createdBy: params.createdBy,
        updatedBy: params.createdBy,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return rows[0]!;
  }

  async findById(id: string): Promise<JiraConnection | undefined> {
    const rows = await this.db
      .select()
      .from(jiraConnections)
      .where(eq(jiraConnections.id, id))
      .limit(1);
    return rows[0];
  }

  async findByCloudId(cloudId: string): Promise<JiraConnection | undefined> {
    // This query intentionally bypasses tenant filter to detect cross-tenant conflicts.
    // It uses a raw DB connection without tenant context.
    const rows = await this.db
      .select()
      .from(jiraConnections)
      .where(eq(jiraConnections.cloudId, cloudId))
      .limit(1);
    return rows[0];
  }

  async findAll(opts: { limit: number; cursor?: string }): Promise<JiraConnection[]> {
    const conditions = opts.cursor
      ? and(gt(jiraConnections.id, opts.cursor))
      : undefined;

    const query = this.db
      .select()
      .from(jiraConnections)
      .orderBy(asc(jiraConnections.createdAt))
      .limit(opts.limit);

    if (conditions) {
      return query.where(conditions);
    }
    return query;
  }

  async update(
    id: string,
    params: UpdateConnectionParams,
    updatedBy: string,
  ): Promise<JiraConnection | undefined> {
    const rows = await this.db
      .update(jiraConnections)
      .set({
        ...params,
        updatedBy,
        updatedAt: new Date(),
      })
      .where(eq(jiraConnections.id, id))
      .returning();
    return rows[0];
  }

  async updateTokenExpiry(id: string, tokenExpiresAt: Date): Promise<void> {
    await this.db
      .update(jiraConnections)
      .set({ tokenExpiresAt, updatedAt: new Date() })
      .where(eq(jiraConnections.id, id));
  }

  async updateState(
    id: string,
    state: 'pending' | 'active' | 'degraded' | 'revoked',
    updatedBy: string,
  ): Promise<JiraConnection | undefined> {
    const rows = await this.db
      .update(jiraConnections)
      .set({ state, updatedBy, updatedAt: new Date() })
      .where(eq(jiraConnections.id, id))
      .returning();
    return rows[0];
  }
}
