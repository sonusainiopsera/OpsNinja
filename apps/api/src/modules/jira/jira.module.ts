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

@Module({
  imports: [AuditModule],
  controllers: [
    JiraConnectionsController,
    JiraOAuthController,
    JiraLinksController,
    JiraHealthController,
    JiraAuditController,
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
  ],
  exports: [JiraConnectionsService, JiraTokenProvider, JiraLinksService, JiraAuditRecorder],
})
export class JiraModule {}
