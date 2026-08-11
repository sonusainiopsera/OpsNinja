import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JiraConnectionsController } from './connections/jira-connections.controller';
import { JiraConnectionsService } from './connections/jira-connections.service';
import { JiraConnectionsRepository } from './connections/jira-connections.repository';
import { JiraOAuthService } from './connections/jira-oauth.service';
import { CredentialVaultService } from './connections/credential-vault.service';
import { JiraTokenProvider } from './tokens/jira-token.provider';
import { ENVELOPE_CIPHER_PORT, KmsEnvelopeCipher } from '@opsninja/crypto';

@Module({
  controllers: [JiraConnectionsController],
  providers: [
    JiraConnectionsService,
    JiraConnectionsRepository,
    JiraOAuthService,
    CredentialVaultService,
    JiraTokenProvider,
    {
      provide: ENVELOPE_CIPHER_PORT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => new KmsEnvelopeCipher(config),
    },
  ],
  exports: [JiraConnectionsService, JiraTokenProvider],
})
export class JiraModule {}
