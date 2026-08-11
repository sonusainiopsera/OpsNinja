/**
 * AppModule for jira-webhook-receiver.
 *
 * Minimal NestJS module — no global auth guard, no tenant context interceptor.
 * The receiver is internet-exposed and authenticates solely via HMAC-SHA-256.
 */

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
  CreateSecretCommand,
  UpdateSecretCommand,
  DeleteSecretCommand,
  ResourceExistsException,
} from '@aws-sdk/client-secrets-manager';
import { KmsEnvelopeCipher } from '@opsninja/crypto';
import { WebhookController } from './webhook.controller';
import { IngestService } from './ingest.service';
import { REDIS_CLIENT, createRedisClient } from './redis.provider';
import { CREDENTIAL_VAULT, type CredentialVaultPort } from './credential-vault.port';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env.local', '.env'] }),
  ],
  controllers: [WebhookController],
  providers: [
    IngestService,
    {
      provide: REDIS_CLIENT,
      useFactory: () => createRedisClient(),
    },
    {
      provide: CREDENTIAL_VAULT,
      useFactory: (): CredentialVaultPort => new AwsSecretVaultAdapter(
        process.env['KMS_JIRA_KEY_ARN'] ?? 'arn:aws:kms:us-east-1:000000000000:key/placeholder',
      ),
    },
  ],
})
export class AppModule {}

// ---------------------------------------------------------------------------
// Inline production vault adapter (avoids cross-app import from api)
// ---------------------------------------------------------------------------

class AwsSecretVaultAdapter implements CredentialVaultPort {
  private readonly sm: SecretsManagerClient;
  private readonly cipher: KmsEnvelopeCipher;

  constructor(kmsKeyArn: string) {
    this.sm = new SecretsManagerClient({ region: process.env['AWS_REGION'] ?? 'us-east-1' });
    this.cipher = new KmsEnvelopeCipher(kmsKeyArn);
  }

  async store(secretName: string, plaintext: string, tenantId: string): Promise<string> {
    const { ciphertext } = await this.cipher.encrypt(plaintext, tenantId);
    try {
      await this.sm.send(new CreateSecretCommand({ Name: secretName, SecretString: ciphertext }));
    } catch (err) {
      if (err instanceof ResourceExistsException) {
        await this.sm.send(new UpdateSecretCommand({ SecretId: secretName, SecretString: ciphertext }));
      } else {
        throw err;
      }
    }
    return secretName;
  }

  async retrieve(secretRef: string, tenantId: string): Promise<string> {
    const result = await this.sm.send(new GetSecretValueCommand({ SecretId: secretRef }));
    if (!result.SecretString) throw new Error(`Secret ${secretRef} is empty`);
    return this.cipher.decrypt(result.SecretString, tenantId);
  }

  async delete(secretRef: string): Promise<void> {
    await this.sm.send(new DeleteSecretCommand({ SecretId: secretRef, ForceDeleteWithoutRecovery: true }));
  }
}
