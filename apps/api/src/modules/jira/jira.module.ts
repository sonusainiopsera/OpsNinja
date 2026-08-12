import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { JiraConnectionsController } from './connections/jira-connections.controller';
import { JiraOAuthController } from './oauth/jira-oauth.controller';
import { JiraConnectionsService } from './connections/jira-connections.service';
import { JiraConnectionsRepository } from './connections/jira-connections.repository';
import { JiraOAuthService } from './oauth/jira-oauth.service';
import { JiraHttpClient } from './http/jira-http.client';
import { JiraTokenProvider } from './tokens/jira-token.provider';
import {
  CREDENTIAL_VAULT,
  AwsSecretVaultAdapter,
} from './tokens/credential-vault.service';
// WO-053: Jira links submodule
import { JiraLinksController } from './links/jira-links.controller';
import { JiraLinksService, TicketDataRepository } from './links/jira-links.service';
import { JiraLinksRepository } from './links/jira-links.repository';
import { JiraPayloadBuilder } from './links/jira-payload.builder';
import { JiraMappingRepository } from './mapping/jira-mapping.repository';
import { AuditWriter } from '../audit/audit-writer';
// WO-058: health + webhook-secret rotation
import { JiraHealthController } from './health/jira-health.controller';
import { JiraHealthService, JiraEventsReadRepository } from './health/jira-health.service';
import { RedisCacheService } from '../../infra/cache/redis-cache';
// WO-059: audit trail and observability
import { JiraAuditController } from './audit/jira-audit.controller';
import { JiraAuditRecorder } from './audit/jira-audit.recorder';
// WO-056: DLQ inspection and replay
import { JiraDlqController } from './dlq/jira-dlq.controller';
import { JiraDlqService } from './dlq/jira-dlq.service';
import { JiraDlqRepository } from './dlq/jira-dlq.repository';
// WO-057: reconciliation run history and manual trigger
import { JiraReconciliationController } from './reconciliation/jira-reconciliation.controller';
import { JiraReconciliationService, SQS_CLIENT, JIRA_SYNC_QUEUE_URL } from './reconciliation/jira-reconciliation.service';
import { JiraReconciliationRepository } from './reconciliation/jira-reconciliation.repository';
import { SQSClient } from '@aws-sdk/client-sqs';

@Module({
  imports: [AuditModule],
  controllers: [
    JiraConnectionsController,
    JiraOAuthController,
    JiraLinksController,
    JiraHealthController,
    JiraAuditController,
    JiraDlqController,
    JiraReconciliationController,
  ],
  providers: [
    JiraConnectionsService,
    JiraConnectionsRepository,
    JiraOAuthService,
    JiraHttpClient,
    JiraTokenProvider,
    {
      provide: CREDENTIAL_VAULT,
      useFactory: () =>
        new AwsSecretVaultAdapter(
          process.env['KMS_JIRA_KEY_ARN'] ?? 'arn:aws:kms:us-east-1:000000000000:key/placeholder',
        ),
    },
    {
      provide: 'JIRA_CONNECTIONS_REPOSITORY',
      useExisting: JiraConnectionsRepository,
    },
    // WO-053: links submodule
    JiraLinksController,
    JiraLinksService,
    JiraLinksRepository,
    JiraPayloadBuilder,
    JiraMappingRepository,
    TicketDataRepository,
    AuditWriter,
    // WO-058: health submodule
    JiraHealthController,
    JiraHealthService,
    JiraEventsReadRepository,
    RedisCacheService,
    // WO-059: audit recorder
    JiraAuditRecorder,
    // WO-056: DLQ inspection and replay
    JiraDlqController,
    JiraDlqService,
    JiraDlqRepository,
    // WO-057: reconciliation run history and manual trigger
    JiraReconciliationController,
    JiraReconciliationService,
    JiraReconciliationRepository,
    {
      provide: SQS_CLIENT,
      useFactory: () =>
        new SQSClient({ region: process.env['AWS_REGION'] ?? 'us-east-1' }),
    },
    {
      provide: JIRA_SYNC_QUEUE_URL,
      useFactory: () =>
        process.env['JIRA_SYNC_QUEUE_URL'] ?? 'https://sqs.us-east-1.amazonaws.com/000000000000/jira-sync',
    },
  ],
  exports: [JiraConnectionsService, JiraTokenProvider, JiraLinksService, JiraAuditRecorder],
})
export class JiraModule {}
