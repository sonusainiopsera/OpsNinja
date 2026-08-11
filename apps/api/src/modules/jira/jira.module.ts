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

@Module({
  imports: [AuditModule],
  controllers: [JiraConnectionsController, JiraOAuthController],
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
  ],
  exports: [JiraConnectionsService, JiraTokenProvider],
})
export class JiraModule {}
