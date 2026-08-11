import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { validateWebhookUrl } from './webhook-url-validator';
import { WebhookSecretService } from './webhook-secret.service';
import { WebhookEndpointsRepository } from './webhook-endpoints.repository';
import { findInvalidEventTypes } from './event-catalogue';
import type {
  CreateWebhookEndpointDto,
  ListWebhookEndpointsQuery,
  UpdateWebhookEndpointDto,
  WebhookEndpointCreatedResponse,
  WebhookEndpointSummary,
  RotateSecretResponse,
  TestFireResponse,
} from './dto/webhook-endpoint.dto';
import type { PrincipalContext } from '../../observability/request-context';

const RESPONSE_SNIPPET_MAX = 512;
const TEST_TIMEOUT_MS = 10_000;

@Injectable()
export class WebhookEndpointsService {
  private readonly logger = new Logger(WebhookEndpointsService.name);

  constructor(
    private readonly repository: WebhookEndpointsRepository,
    private readonly secretService: WebhookSecretService,
  ) {}

  async create(
    dto: CreateWebhookEndpointDto,
    principal: PrincipalContext,
  ): Promise<WebhookEndpointCreatedResponse> {
    await this.assertValidUrl(dto.url);
    this.assertValidEventTypes(dto.eventTypes);

    const { plaintextBase64, ciphertext, keyVersion } =
      await this.secretService.generateSecret(principal.tenantId);

    const row = await this.repository.create({
      tenantId: principal.tenantId,
      url: dto.url,
      description: dto.description ?? null,
      eventTypes: dto.eventTypes,
      secretCiphertext: ciphertext,
      secretKeyVersion: keyVersion,
      createdBy: principal.userId,
    });

    await this.repository.writeAudit({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'webhook_endpoint.created',
      resourceId: row.id,
      details: { url: dto.url, eventTypes: dto.eventTypes },
      occurredAt: new Date(),
    });

    return {
      id: row.id,
      url: row.url,
      description: row.description,
      eventTypes: row.eventTypes,
      status: row.status,
      secret: plaintextBase64,
      secretKeyVersion: row.secretKeyVersion,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async list(
    query: ListWebhookEndpointsQuery,
    principal: PrincipalContext,
  ): Promise<{ data: WebhookEndpointSummary[]; cursor: string | null }> {
    const { rows, nextCursor } = await this.repository.findPage(
      principal.tenantId,
      query.cursor,
      query.limit,
    );
    return {
      data: rows.map(toSummary),
      cursor: nextCursor,
    };
  }

  async getOne(id: string, principal: PrincipalContext): Promise<WebhookEndpointSummary> {
    const row = await this.repository.findById(principal.tenantId, id);
    if (!row) throw new NotFoundException(notFoundError(id));
    return toSummary(row);
  }

  async update(
    id: string,
    dto: UpdateWebhookEndpointDto,
    principal: PrincipalContext,
  ): Promise<WebhookEndpointSummary> {
    const existing = await this.repository.findById(principal.tenantId, id);
    if (!existing) throw new NotFoundException(notFoundError(id));

    if (dto.url) await this.assertValidUrl(dto.url);
    if (dto.eventTypes) this.assertValidEventTypes(dto.eventTypes);

    const updated = await this.repository.update(principal.tenantId, id, {
      url: dto.url,
      description: dto.description,
      eventTypes: dto.eventTypes,
    });
    if (!updated) throw new NotFoundException(notFoundError(id));

    await this.repository.writeAudit({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'webhook_endpoint.updated',
      resourceId: id,
      details: {
        changes: {
          url: dto.url,
          description: dto.description,
          eventTypes: dto.eventTypes,
        },
      },
      occurredAt: new Date(),
    });

    return toSummary(updated);
  }

  async delete(id: string, principal: PrincipalContext): Promise<void> {
    const existing = await this.repository.findById(principal.tenantId, id);
    if (!existing) throw new NotFoundException(notFoundError(id));

    const deleted = await this.repository.softDelete(principal.tenantId, id);
    if (!deleted) throw new NotFoundException(notFoundError(id));

    await this.repository.writeAudit({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'webhook_endpoint.deleted',
      resourceId: id,
      details: {},
      occurredAt: new Date(),
    });
  }

  async rotateSecret(id: string, principal: PrincipalContext): Promise<RotateSecretResponse> {
    const existing = await this.repository.findById(principal.tenantId, id);
    if (!existing) throw new NotFoundException(notFoundError(id));

    const { plaintextBase64, ciphertext, keyVersion, previousSecretExpiresAt } =
      await this.secretService.rotateSecret(principal.tenantId);

    await this.repository.update(principal.tenantId, id, {
      secretCiphertext: ciphertext,
      secretKeyVersion: keyVersion,
      previousSecretCiphertext: existing.secretCiphertext,
      previousSecretExpiresAt,
    });

    await this.repository.writeAudit({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'webhook_endpoint.secret_rotated',
      resourceId: id,
      details: { secretKeyVersion: keyVersion },
      occurredAt: new Date(),
    });

    return {
      secret: plaintextBase64,
      secretKeyVersion: keyVersion,
      previousSecretExpiresAt: previousSecretExpiresAt.toISOString(),
    };
  }

  async disable(id: string, principal: PrincipalContext): Promise<WebhookEndpointSummary> {
    const existing = await this.repository.findById(principal.tenantId, id);
    if (!existing) throw new NotFoundException(notFoundError(id));

    const updated = await this.repository.update(principal.tenantId, id, { status: 'disabled' });
    if (!updated) throw new NotFoundException(notFoundError(id));

    await this.repository.writeAudit({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'webhook_endpoint.disabled',
      resourceId: id,
      details: {},
      occurredAt: new Date(),
    });

    return toSummary(updated);
  }

  async enable(id: string, principal: PrincipalContext): Promise<WebhookEndpointSummary> {
    const existing = await this.repository.findById(principal.tenantId, id);
    if (!existing) throw new NotFoundException(notFoundError(id));

    const updated = await this.repository.update(principal.tenantId, id, { status: 'active' });
    if (!updated) throw new NotFoundException(notFoundError(id));

    await this.repository.writeAudit({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'webhook_endpoint.enabled',
      resourceId: id,
      details: {},
      occurredAt: new Date(),
    });

    return toSummary(updated);
  }

  async testFire(id: string, principal: PrincipalContext): Promise<TestFireResponse> {
    const existing = await this.repository.findById(principal.tenantId, id);
    if (!existing) throw new NotFoundException(notFoundError(id));

    // Re-validate SSRF before delivery (DNS rebinding defence).
    const validation = await validateWebhookUrl(existing.url);
    if (!validation.valid) {
      throw new UnprocessableEntityException({
        code: validation.code,
        message: validation.message,
      });
    }

    const payload = JSON.stringify({
      eventType: 'webhook.ping',
      tenantId: principal.tenantId,
      endpointId: id,
      occurredAt: new Date().toISOString(),
    });

    const startMs = Date.now();

    try {
      const signal = AbortSignal.timeout(TEST_TIMEOUT_MS);
      const response = await fetch(existing.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-OpsNinja-Event': 'webhook.ping',
        },
        body: payload,
        signal,
      });

      const latencyMs = Date.now() - startMs;
      const rawText = await response.text().catch(() => '');
      const responseSnippet = rawText.substring(0, RESPONSE_SNIPPET_MAX) || null;

      return { httpStatus: response.status, latencyMs, responseSnippet, timedOut: false };
    } catch (err) {
      const latencyMs = Date.now() - startMs;
      if (err instanceof Error && err.name === 'AbortError') {
        this.logger.warn(`Webhook test-fire timed out for endpoint ${id} after ${TEST_TIMEOUT_MS}ms`);
        return { httpStatus: null, latencyMs, responseSnippet: null, timedOut: true };
      }
      this.logger.warn(`Webhook test-fire delivery error for endpoint ${id}`, {
        error: err instanceof Error ? err.message : String(err),
      });
      return { httpStatus: null, latencyMs, responseSnippet: null, timedOut: false };
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async assertValidUrl(url: string): Promise<void> {
    const result = await validateWebhookUrl(url);
    if (!result.valid) {
      throw new UnprocessableEntityException({
        code: result.code,
        message: result.message,
      });
    }
  }

  private assertValidEventTypes(eventTypes: string[]): void {
    const invalid = findInvalidEventTypes(eventTypes);
    if (invalid.length > 0) {
      throw new BadRequestException({
        code: 'INVALID_EVENT_TYPES',
        message: 'One or more event types are not in the catalogue.',
        details: invalid,
      });
    }
  }
}

function toSummary(row: {
  id: string;
  url: string;
  description: string | null;
  eventTypes: string[];
  status: string;
  secretKeyVersion: number;
  consecutiveFailures: number;
  lastSuccessAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): WebhookEndpointSummary {
  return {
    id: row.id,
    url: row.url,
    description: row.description,
    eventTypes: row.eventTypes,
    status: row.status,
    secretKeyVersion: row.secretKeyVersion,
    consecutiveFailures: row.consecutiveFailures,
    lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function notFoundError(id: string) {
  return { code: 'WEBHOOK_ENDPOINT_NOT_FOUND', message: `Webhook endpoint '${id}' not found.` };
}
