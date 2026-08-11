/**
 * WebhookDeliveriesController
 *
 * GET /api/v1/webhooks/endpoints/:id/deliveries
 *   Cursor-paginated delivery attempt history for an endpoint.
 *   Returns redacted response snippets.
 *
 * POST /api/v1/webhooks/deliveries/:id/replay
 *   Re-enqueues the stored canonical payload with a new attempt number.
 *   Returns 202 with the replay event ID and new attempt number.
 *
 * Both endpoints require the 'webhook:manage' permission.
 * 404 returned for endpoints/deliveries outside the caller's tenant scope.
 */

import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import {
  SQSClient,
  SendMessageCommand,
} from '@aws-sdk/client-sqs';
import { randomUUID } from 'crypto';
import { RequirePermission } from '../../common/auth/require-permission.decorator';
import { withTenantTransaction } from '../../data/unit-of-work';
import { getPrincipalContext } from '../../observability/request-context';
import { WebhookDeliveriesRepository } from './webhook-deliveries.repository';
import { WebhookEndpointsRepository } from './webhook-endpoints.repository';
import type { WebhookDeliveryStatus } from '@opsninja/db';

const MAX_PAGE_LIMIT = 100;
const DEFAULT_PAGE_LIMIT = 50;

@Controller()
@RequirePermission('webhook:manage')
export class WebhookDeliveriesController {
  private readonly logger = new Logger(WebhookDeliveriesController.name);
  private readonly sqs = new SQSClient({ region: process.env['AWS_REGION'] ?? 'us-east-1' });

  constructor(
    private readonly deliveriesRepo: WebhookDeliveriesRepository,
    private readonly endpointsRepo: WebhookEndpointsRepository,
  ) {}

  @Get('api/v1/webhooks/endpoints/:id/deliveries')
  async listDeliveries(
    @Param('id') endpointId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limitStr?: string,
    @Query('status') status?: string,
  ) {
    const { tenantId } = getPrincipalContext();
    const limit = limitStr
      ? Math.min(parseInt(limitStr, 10) || DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT)
      : DEFAULT_PAGE_LIMIT;

    return withTenantTransaction({ ...getPrincipalContext() }, async () => {
      // Verify endpoint belongs to this tenant (404-for-out-of-scope)
      const endpoint = await this.endpointsRepo.findById(endpointId);
      if (!endpoint || endpoint.deletedAt !== null) {
        throw new NotFoundException({ error: { code: 'ENDPOINT_NOT_FOUND', message: 'Endpoint not found' } });
      }

      const page = await this.deliveriesRepo.listByEndpoint(
        endpointId,
        limit,
        cursor,
        status as WebhookDeliveryStatus | undefined,
      );

      return {
        data: page.data.map((d) => ({
          id: d.id,
          eventId: d.eventId,
          eventType: d.eventType,
          attempt: d.attempt,
          status: d.status,
          httpStatus: d.httpStatus,
          latencyMs: d.latencyMs,
          errorCode: d.errorCode,
          responseSnippet: d.responseSnippet,
          createdAt: d.createdAt,
        })),
        cursor: page.cursor,
      };
    });
  }

  @Post('api/v1/webhooks/deliveries/:id/replay')
  @HttpCode(HttpStatus.ACCEPTED)
  async replayDelivery(@Param('id') deliveryId: string) {
    const principal = getPrincipalContext();

    return withTenantTransaction(principal, async () => {
      const delivery = await this.deliveriesRepo.findById(deliveryId);
      if (!delivery) {
        throw new NotFoundException({ error: { code: 'DELIVERY_NOT_FOUND', message: 'Delivery not found' } });
      }

      // Verify endpoint still exists and is not deleted
      const endpoint = await this.endpointsRepo.findById(delivery.endpointId);
      if (!endpoint || endpoint.deletedAt !== null) {
        throw new ConflictException({ error: { code: 'ENDPOINT_DELETED', message: 'Endpoint has been deleted' } });
      }

      const nextAttempt = await this.deliveriesRepo.getNextAttemptNumber(
        delivery.endpointId,
        delivery.eventId,
      );

      const replayEventId = randomUUID();
      const queueUrl = process.env['WEBHOOK_SQS_QUEUE_URL'] ?? '';

      const envelope = {
        version: '1',
        type: 'webhook_delivery',
        data: {
          tenantId: delivery.tenantId,
          endpointId: delivery.endpointId,
          eventId: delivery.eventId,
          eventType: delivery.eventType,
          occurredAt: new Date().toISOString(),
          attempt: nextAttempt,
          data: (delivery.canonicalPayload as Record<string, unknown>)['data'] ?? {},
          traceId: principal.traceId,
        },
      };

      await this.sqs.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify(envelope),
          MessageGroupId: delivery.endpointId,
        }),
      );

      this.logger.log('Webhook delivery replayed', {
        tenantId: delivery.tenantId,
        endpointId: delivery.endpointId,
        eventId: delivery.eventId,
        nextAttempt,
      });

      return { data: { replayEventId, attempt: nextAttempt } };
    });
  }
}
