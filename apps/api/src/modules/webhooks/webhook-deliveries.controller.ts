import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Request } from 'express';
import { z, ZodError } from 'zod';
import {
  SQSClient,
  SendMessageCommand,
} from '@aws-sdk/client-sqs';
import { ConfigService } from '@nestjs/config';
import { RequirePermission } from '../../common/auth/require-permission.decorator';
import { Permission } from '../../common/auth/permissions';
import type { PrincipalContext } from '../../observability/request-context';
import { WebhookDeliveriesRepository } from './webhook-deliveries.repository';
import { WebhookEndpointsRepository } from './webhook-endpoints.repository';

type AuthRequest = Request & { user?: PrincipalContext };

const ListDeliveriesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().uuid().optional(),
  status: z.enum(['pending', 'delivered', 'failed', 'dropped']).optional(),
});

const RESPONSE_SNIPPET_REDACT = /Authorization\s*:\s*\S+/gi;

@Controller('api/v1/webhooks')
export class WebhookDeliveriesController {
  private readonly sqs: SQSClient;

  constructor(
    private readonly deliveriesRepo: WebhookDeliveriesRepository,
    private readonly endpointsRepo: WebhookEndpointsRepository,
    private readonly config: ConfigService,
  ) {
    this.sqs = new SQSClient({
      region: config.get<string>('AWS_REGION', 'us-east-1'),
    });
  }

  @Get('endpoints/:id/deliveries')
  @RequirePermission(Permission.WEBHOOKS_MANAGE)
  async listDeliveries(
    @Param('id') endpointId: string,
    @Query() rawQuery: unknown,
    @Req() req: AuthRequest,
  ) {
    const principal = getPrincipal(req);
    const query = parseQuery(ListDeliveriesQuerySchema, rawQuery);

    const endpoint = await this.endpointsRepo.findById(principal.tenantId, endpointId);
    if (!endpoint) {
      throw new NotFoundException({ code: 'ENDPOINT_NOT_FOUND' });
    }

    const rows = await this.deliveriesRepo.findByEndpoint({
      tenantId: principal.tenantId,
      endpointId,
      limit: query.limit,
      cursor: query.cursor,
      status: query.status,
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const nextCursor = hasMore ? page[page.length - 1].id : null;

    return {
      data: page.map((r) => ({
        id: r.id,
        endpointId: r.endpointId,
        eventId: r.eventId,
        eventType: r.eventType,
        attempt: r.attempt,
        status: r.status,
        httpStatus: r.httpStatus,
        latencyMs: r.latencyMs,
        responseSnippet: r.responseSnippet
          ? r.responseSnippet.replace(RESPONSE_SNIPPET_REDACT, 'Authorization: [REDACTED]')
          : null,
        errorCode: r.errorCode,
        createdAt: r.createdAt.toISOString(),
      })),
      meta: {
        nextCursor,
        hasMore,
      },
    };
  }

  @Post('deliveries/:id/replay')
  @RequirePermission(Permission.WEBHOOKS_MANAGE)
  @HttpCode(HttpStatus.ACCEPTED)
  async replay(
    @Param('id') deliveryId: string,
    @Req() req: AuthRequest,
  ) {
    const principal = getPrincipal(req);

    const delivery = await this.deliveriesRepo.findById(principal.tenantId, deliveryId);
    if (!delivery) {
      throw new NotFoundException({ code: 'DELIVERY_NOT_FOUND' });
    }

    const endpoint = await this.endpointsRepo.findById(principal.tenantId, delivery.endpointId);
    if (!endpoint) {
      throw new NotFoundException({ code: 'ENDPOINT_NOT_FOUND' });
    }

    const nextAttempt = await this.deliveriesRepo.getNextAttemptNumber(
      principal.tenantId,
      delivery.endpointId,
      delivery.eventId,
    );

    const queueUrl = this.config.getOrThrow<string>('SQS_WEBHOOK_QUEUE_URL');

    const envelopePayload = delivery.canonicalPayload as {
      id?: string;
      type?: string;
      occurredAt?: string;
      tenantId?: string;
      data?: Record<string, unknown>;
    };

    const message = {
      tenantId: principal.tenantId,
      endpointId: delivery.endpointId,
      eventId: delivery.eventId,
      eventType: delivery.eventType,
      occurredAt: envelopePayload.occurredAt ?? new Date().toISOString(),
      attempt: nextAttempt,
      data: envelopePayload.data ?? {},
    };

    await this.sqs.send(new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(message),
    }));

    return {
      data: {
        deliveryId,
        endpointId: delivery.endpointId,
        eventId: delivery.eventId,
        attempt: nextAttempt,
        enqueued: true,
      },
    };
  }
}

function getPrincipal(req: AuthRequest): PrincipalContext {
  if (!req.user) throw new NotFoundException({ code: 'UNAUTHENTICATED' });
  return req.user;
}

function parseQuery<T>(schema: { parse(v: unknown): T }, raw: unknown): T {
  try {
    return schema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new UnprocessableEntityException({
        code: 'SCHEMA_VIOLATION',
        message: 'Query parameters did not match the expected schema.',
        details: err.errors.map((e) => ({ path: e.path.join('.'), message: e.message })),
      });
    }
    throw err;
  }
}
