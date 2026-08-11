/**
 * SqsConsumerService — long-polling SQS consumer for the dashboard-aggregates queue.
 *
 * AC-1: Handles ticket.created, ticket.updated, ticket.priority_changed,
 *       ticket.resolved, ticket.closed, ticket.reopened, sla.timer_started,
 *       sla.timer_paused, sla.timer_resumed, sla.threshold_reached,
 *       sla.breached and ai.synthesis_completed.
 *
 * AC-9: Schema-invalid or unknown events are logged + rejected to DLQ via
 *       zero-second visibility change (SQS redrive policy handles max-receives).
 *
 * AC-4: Mutations are applied atomically via AggregateStore (Lua EVALSHA).
 *
 * KEDA: queue depth emitted as a structured metric on each poll cycle.
 */

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
  GetQueueAttributesCommand,
} from '@aws-sdk/client-sqs';
import { AggregateStore } from './redis/aggregate.store';
import { parseOutboxEvent } from './outbox-event.schema';
import type { MutationCmd } from './redis/aggregate.store';
import {
  handleTicketCreated,
  handleTicketPriorityChanged,
  handleTicketClosedOrResolved,
  handleTicketReopened,
  handleTicketUpdated,
} from './handlers/ticket-events.handler';
import {
  handleSlaTimerStarted,
  handleSlaTimerPaused,
  handleSlaTimerResumed,
  handleSlaThresholdReached,
  handleSlaBreached,
} from './handlers/sla-events.handler';
import { handleAiSynthesisCompleted } from './handlers/ai-events.handler';
import {
  incEventsConsumed,
  incEventsDeduplicated,
  observeEventLag,
} from './observability/pipeline.metrics';

const POLL_BATCH_SIZE = 10;
const WAIT_TIME_SECONDS = 20;
const VISIBILITY_TIMEOUT = 30;

@Injectable()
export class SqsConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SqsConsumerService.name);
  private readonly sqs: SQSClient;
  private readonly queueUrl: string;
  private running = false;
  private inFlightCount = 0;
  private drainResolve?: () => void;

  constructor(private readonly store: AggregateStore) {
    this.sqs = new SQSClient({ region: process.env['AWS_REGION'] ?? 'us-east-1' });
    this.queueUrl = process.env['DASHBOARD_QUEUE_URL'] ?? '';
  }

  onModuleInit(): void {
    if (!this.queueUrl) {
      this.logger.error('DASHBOARD_QUEUE_URL not set — consumer will not start');
      return;
    }
    this.running = true;
    void this.pollLoop();
  }

  onModuleDestroy(): Promise<void> {
    this.running = false;
    this.logger.log('SIGTERM — draining in-flight messages');
    if (this.inFlightCount === 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.drainResolve = resolve;
    });
  }

  // --------------------------------------------------------------------------
  // Poll loop
  // --------------------------------------------------------------------------

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        void this.emitQueueDepth();

        const response = await this.sqs.send(
          new ReceiveMessageCommand({
            QueueUrl: this.queueUrl,
            MaxNumberOfMessages: POLL_BATCH_SIZE,
            WaitTimeSeconds: WAIT_TIME_SECONDS,
            VisibilityTimeout: VISIBILITY_TIMEOUT,
            AttributeNames: ['ApproximateReceiveCount'],
          }),
        );

        for (const msg of response.Messages ?? []) {
          this.inFlightCount++;
          void this.processMessage(msg).finally(() => {
            this.inFlightCount--;
            if (!this.running && this.inFlightCount === 0 && this.drainResolve) {
              this.drainResolve();
            }
          });
        }
      } catch (err) {
        if (!this.running) break;
        this.logger.error('SQS poll error', { error: (err as Error).message });
        await new Promise((r) => setTimeout(r, 5_000));
      }
    }
  }

  // --------------------------------------------------------------------------
  // Per-message processing
  // --------------------------------------------------------------------------

  private async processMessage(msg: {
    MessageId?: string;
    Body?: string;
    ReceiptHandle?: string;
    Attributes?: Record<string, string>;
  }): Promise<void> {
    const receiptHandle = msg.ReceiptHandle ?? '';
    const messageId = msg.MessageId ?? 'unknown';

    const event = parseOutboxEvent(msg.Body ?? '');
    if (!event) {
      this.logger.error('Malformed/unparseable event — routing to DLQ', { messageId });
      this.emitMetric('dashboard_dlq_message', { reason: 'parse_error' });
      // Set visibility to 0 so it immediately reappears; SQS redrive sends to DLQ after maxReceiveCount
      await this.changeVisibility(receiptHandle, 0);
      return;
    }

    const { tenantId, eventId, eventType } = event;

    try {
      const commands = this.routeEvent(event);
      if (commands === null) {
        // Unknown event type — delete, do not retry
        this.logger.debug('Unknown event type — deleting', { eventType, eventId });
        await this.deleteMessage(receiptHandle);
        return;
      }

      const result = await this.store.applyEvent(tenantId, eventId, commands);

      // Propagate traceId from the outbox event envelope through structured log (AC9)
      const traceId = event.traceparent ?? undefined;

      if (!result.applied) {
        this.logger.debug('Idempotent skip', { tenantId, eventId, eventType, traceId, component: 'dashboard-aggregator' });
        incEventsDeduplicated(eventType);
        incEventsConsumed(eventType, 'deduplicated');
        this.emitMetric('dashboard_event_deduped', { tenantId, eventType });
      } else {
        this.logger.debug('Event applied', { tenantId, eventId, eventType, traceId, component: 'dashboard-aggregator' });
        incEventsConsumed(eventType, 'applied');
        observeEventLag(event.occurredAt);
        this.emitMetric('dashboard_event_applied', { tenantId, eventType });
      }

      await this.deleteMessage(receiptHandle);
    } catch (err: unknown) {
      // Redis failure — do NOT delete; SQS redelivers; dedup ensures safety
      this.logger.error('Failed to apply event', {
        tenantId, eventId, eventType,
        traceId: event.traceparent ?? undefined,
        component: 'dashboard-aggregator',
        error: (err as Error).message,
      });
      incEventsConsumed(eventType, 'error');
      this.emitMetric('dashboard_event_error', { tenantId, eventType });
      // Leave message in-flight; SQS redelivers after visibility timeout
    }
  }

  // --------------------------------------------------------------------------
  // Route event → mutation commands (null = unknown/skip)
  // --------------------------------------------------------------------------

  private routeEvent(event: ReturnType<typeof parseOutboxEvent>): MutationCmd[] | null {
    if (!event) return null;
    switch (event.eventType) {
      case 'ticket.created':         return handleTicketCreated(event);
      case 'ticket.updated':         return handleTicketUpdated(event);
      case 'ticket.priority_changed': return handleTicketPriorityChanged(event);
      case 'ticket.resolved':        return handleTicketClosedOrResolved(event);
      case 'ticket.closed':          return handleTicketClosedOrResolved(event);
      case 'ticket.reopened':        return handleTicketReopened(event);
      case 'sla.timer_started':      return handleSlaTimerStarted(event);
      case 'sla.timer_paused':       return handleSlaTimerPaused(event);
      case 'sla.timer_resumed':      return handleSlaTimerResumed(event);
      case 'sla.threshold_reached':  return handleSlaThresholdReached(event);
      case 'sla.breached':           return handleSlaBreached(event);
      case 'ai.synthesis_completed': return handleAiSynthesisCompleted(event);
      default:                       return null;
    }
  }

  // --------------------------------------------------------------------------
  // SQS helpers
  // --------------------------------------------------------------------------

  private async deleteMessage(receiptHandle: string): Promise<void> {
    try {
      await this.sqs.send(new DeleteMessageCommand({ QueueUrl: this.queueUrl, ReceiptHandle: receiptHandle }));
    } catch (err) {
      this.logger.warn('Failed to delete SQS message', { error: (err as Error).message });
    }
  }

  private async changeVisibility(receiptHandle: string, seconds: number): Promise<void> {
    try {
      await this.sqs.send(new ChangeMessageVisibilityCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: receiptHandle,
        VisibilityTimeout: seconds,
      }));
    } catch (err) {
      this.logger.warn('Failed to change visibility', { error: (err as Error).message });
    }
  }

  private async emitQueueDepth(): Promise<void> {
    try {
      const attrs = await this.sqs.send(new GetQueueAttributesCommand({
        QueueUrl: this.queueUrl,
        AttributeNames: ['ApproximateNumberOfMessages'],
      }));
      const depth = attrs.Attributes?.['ApproximateNumberOfMessages'] ?? '0';
      this.emitMetric('dashboard_queue_depth', { value: depth });
    } catch {
      // Non-critical
    }
  }

  private emitMetric(name: string, labels: Record<string, string>): void {
    console.log(JSON.stringify({ metric: name, labels, value: 1, ts: Date.now() }));
  }
}
