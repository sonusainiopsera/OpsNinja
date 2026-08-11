/**
 * WebhookEndpointsService — tenant-scoped CRUD and lifecycle management.
 *
 * Security invariants:
 *  - SSRF validation runs at creation and PATCH when URL changes.
 *  - Signing secrets are generated server-side; never accepted from input.
 *  - Plaintext secret exposed only in the 201 creation response and 200 rotate response.
 *  - Every mutation writes an immutable audit record inside the same transaction.
 *  - KMS failure during creation rolls back the entire transaction (endpoint never persists
 *    without a usable secret).
 */

import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { db, auditLogs } from '@opsninja/db';
import { WebhookEndpointsRepository } from './webhook-endpoints.repository';
import { WebhookSecretService } from './webhook-secret.service';
import { WebhookDispatcher } from './webhook-dispatcher';
import { validateWebhookUrl } from './webhook-url-validator';
import { isValidEventType, VALID_EVENT_TYPES } from './event-catalogue';
import type {
  CreateWebhookEndpointDto,
  UpdateWebhookEndpointDto,
  WebhookEndpointResponse,
  WebhookEndpointCreatedResponse,
  RotateSecretResponse,
  TestFireResponse,
} from './dto/webhook-endpoint.dto';
import type { WebhookEndpoint } from '@opsninja/db';
import { getPrincipalContext } from '../../observability/request-context';

const PAGE_SIZE = 50;

function toResponse(endpoint: WebhookEndpoint): WebhookEndpointResponse {
  return {
    id: endpoint.id,
    url: endpoint.url,
    description: endpoint.description,
    eventTypes: endpoint.eventTypes as string[],
    status: endpoint.status,
    lastSuccessAt: endpoint.lastSuccessAt?.toISOString() ?? null,
    consecutiveFailures: endpoint.consecutiveFailures,
    secretKeyVersion: endpoint.secretKeyVersion,
    createdAt: endpoint.createdAt.toISOString(),
    updatedAt: endpoint.updatedAt.toISOString(),
  };
}

@Injectable()
export class WebhookEndpointsService {
  private readonly logger = new Logger(WebhookEndpointsService.name);

  constructor(
    private readonly repo: WebhookEndpointsRepository,
    private readonly secretService: WebhookSecretService,
    private readonly dispatcher: WebhookDispatcher,
  ) {}

  private validateEventTypes(eventTypes: string[]): void {
    const invalid = eventTypes.filter((e) => !isValidEventType(e));
    if (invalid.length > 0) {
      throw new BadRequestException({
        error: {
          code: 'WEBHOOK_INVALID_EVENT_TYPES',
          message: 'One or more event types are not in the catalogue.',
          details: invalid,
        },
      });
    }
  }

  /** Write an immutable audit record inside the current tenant transaction. */
  private async writeAudit(params: {
    tenantId: string;
    actorId: string;
    eventType: string;
    endpointId: string;
    metadata: Record<string, unknown>;
    traceId: string;
  }): Promise<void> {
    // Write directly to audit_logs inside the current tenant transaction via the
    // shared `db` instance; this is intentional — the audit record must commit or
    // roll back with the main mutation.
    try {
      await db.insert(auditLogs).values({
        tenantId: params.tenantId,
        actorId: params.actorId,
        actorKind: 'staff',
        eventType: params.eventType,
        outcome: 'allowed',
        route: `/api/v1/webhooks/endpoints/${params.endpointId}`,
        traceId: params.traceId,
        metadata: {
          endpointId: params.endpointId,
          ...params.metadata,
          // NEVER include secret or signing_key fields.
        },
      });
    } catch (err) {
      this.logger.error('Audit write failed — rolling back mutation', {
        traceId: params.traceId,
        error: (err as Error).message,
      });
      throw err; // Re-throw so the outer transaction rolls back.
    }
  }

  async create(
    tenantId: string,
    dto: CreateWebhookEndpointDto,
    actorId: string,
    traceId: string,
  ): Promise<WebhookEndpointCreatedResponse> {
    this.validateEventTypes(dto.eventTypes);

    // SSRF validation — fails fast with 422.
    const urlCheck = await validateWebhookUrl(dto.url);
    if (!urlCheck.allowed) {
      throw new UnprocessableEntityException({
        error: {
          code: urlCheck.errorCode,
          message: urlCheck.errorMessage,
          details: [],
          traceId,
        },
      });
    }

    // Generate and encrypt signing secret.
    // KMS failure throws ServiceUnavailableException — nothing is persisted.
    const secret = await this.secretService.generateSecret(tenantId);

    const endpoint = await this.repo.insert({
      tenantId,
      id: randomUUID(),
      url: dto.url,
      description: dto.description ?? null,
      eventTypes: dto.eventTypes,
      status: 'active',
      secretCiphertext: secret.ciphertext,
      secretKeyVersion: secret.keyVersion,
      createdBy: actorId,
    });

    await this.writeAudit({
      tenantId,
      actorId,
      eventType: 'webhook.endpoint.created',
      endpointId: endpoint.id,
      metadata: { url: dto.url, eventTypes: dto.eventTypes },
      traceId,
    });

    return { ...toResponse(endpoint), secret: secret.plaintext };
  }

  async list(
    tenantId: string,
    limit: number = PAGE_SIZE,
    cursor?: string,
  ): Promise<{ data: WebhookEndpointResponse[]; cursor?: string }> {
    const rows = await this.repo.findPage(tenantId, limit, cursor);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      data: page.map(toResponse),
      cursor: hasMore ? page[page.length - 1]?.id : undefined,
    };
  }

  async getById(tenantId: string, id: string): Promise<WebhookEndpointResponse> {
    const endpoint = await this.repo.findById(tenantId, id);
    if (!endpoint) throw new NotFoundException({ error: { code: 'WEBHOOK_NOT_FOUND', message: `Webhook endpoint ${id} not found.` } });
    return toResponse(endpoint);
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateWebhookEndpointDto,
    actorId: string,
    traceId: string,
  ): Promise<WebhookEndpointResponse> {
    const existing = await this.repo.findById(tenantId, id);
    if (!existing) throw new NotFoundException({ error: { code: 'WEBHOOK_NOT_FOUND' } });

    if (dto.eventTypes) this.validateEventTypes(dto.eventTypes);

    if (dto.url && dto.url !== existing.url) {
      const urlCheck = await validateWebhookUrl(dto.url);
      if (!urlCheck.allowed) {
        throw new UnprocessableEntityException({
          error: { code: urlCheck.errorCode, message: urlCheck.errorMessage, traceId },
        });
      }
    }

    const updated = await this.repo.update(tenantId, id, {
      ...(dto.url ? { url: dto.url } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.eventTypes ? { eventTypes: dto.eventTypes } : {}),
    });
    if (!updated) throw new NotFoundException({ error: { code: 'WEBHOOK_NOT_FOUND' } });

    await this.writeAudit({
      tenantId,
      actorId,
      eventType: 'webhook.endpoint.updated',
      endpointId: id,
      metadata: { changes: dto },
      traceId,
    });

    return toResponse(updated);
  }

  async rotateSecret(
    tenantId: string,
    id: string,
    actorId: string,
    traceId: string,
    gracePeriodHours?: number,
  ): Promise<RotateSecretResponse> {
    const existing = await this.repo.findById(tenantId, id);
    if (!existing) throw new NotFoundException({ error: { code: 'WEBHOOK_NOT_FOUND' } });

    const rotation = await this.secretService.rotateSecret(
      tenantId,
      existing.secretCiphertext,
      gracePeriodHours,
    );

    await this.repo.update(tenantId, id, {
      secretCiphertext: rotation.newBundle.ciphertext,
      secretKeyVersion: rotation.newBundle.keyVersion,
      previousSecretCiphertext: rotation.previousCiphertext,
      previousSecretExpiresAt: rotation.previousExpiresAt,
    });

    await this.writeAudit({
      tenantId,
      actorId,
      eventType: 'webhook.endpoint.secret_rotated',
      endpointId: id,
      metadata: { gracePeriodHours, previousExpiresAt: rotation.previousExpiresAt.toISOString() },
      traceId,
    });

    return {
      secret: rotation.newBundle.plaintext,
      secretKeyVersion: rotation.newBundle.keyVersion,
      previousSecretExpiresAt: rotation.previousExpiresAt.toISOString(),
    };
  }

  async disable(tenantId: string, id: string, actorId: string, traceId: string): Promise<void> {
    const existing = await this.repo.findById(tenantId, id);
    if (!existing) throw new NotFoundException({ error: { code: 'WEBHOOK_NOT_FOUND' } });
    await this.repo.update(tenantId, id, { status: 'disabled' });
    await this.writeAudit({
      tenantId, actorId, eventType: 'webhook.endpoint.disabled',
      endpointId: id, metadata: {}, traceId,
    });
  }

  async enable(tenantId: string, id: string, actorId: string, traceId: string): Promise<void> {
    const existing = await this.repo.findById(tenantId, id);
    if (!existing) throw new NotFoundException({ error: { code: 'WEBHOOK_NOT_FOUND' } });
    await this.repo.update(tenantId, id, { status: 'active' });
    await this.writeAudit({
      tenantId, actorId, eventType: 'webhook.endpoint.enabled',
      endpointId: id, metadata: {}, traceId,
    });
  }

  async delete(tenantId: string, id: string, actorId: string, traceId: string): Promise<void> {
    const deleted = await this.repo.softDelete(tenantId, id);
    if (!deleted) throw new NotFoundException({ error: { code: 'WEBHOOK_NOT_FOUND' } });
    await this.writeAudit({
      tenantId, actorId, eventType: 'webhook.endpoint.deleted',
      endpointId: id, metadata: {}, traceId,
    });
  }

  async testFire(
    tenantId: string,
    id: string,
    actorId: string,
    traceId: string,
  ): Promise<TestFireResponse> {
    const endpoint = await this.repo.findById(tenantId, id);
    if (!endpoint) throw new NotFoundException({ error: { code: 'WEBHOOK_NOT_FOUND' } });

    // Decrypt secret — plaintext exists only in this request scope.
    const plaintextSecret = await this.secretService.decryptSecret(
      endpoint.secretCiphertext,
      tenantId,
    );

    const result = await this.dispatcher.testFire(endpoint.url, plaintextSecret);

    await this.writeAudit({
      tenantId, actorId, eventType: 'webhook.endpoint.test_fired',
      endpointId: id,
      metadata: { httpStatus: result.httpStatus, latencyMs: result.latencyMs },
      traceId,
    });

    return result;
  }
}
