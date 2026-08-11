import { Module } from '@nestjs/common';
import { WebhookEndpointsController } from './webhook-endpoints.controller';
import { EventCatalogueController } from './event-catalogue.controller';
import { WebhookEndpointsService } from './webhook-endpoints.service';
import { WebhookEndpointsRepository } from './webhook-endpoints.repository';
import { WebhookSecretService } from './webhook-secret.service';
import { WebhookDispatcher } from './webhook-dispatcher';
import { ENVELOPE_CIPHER, KmsEnvelopeCipher } from '@opsninja/crypto';

@Module({
  controllers: [WebhookEndpointsController, EventCatalogueController],
  providers: [
    WebhookEndpointsService,
    WebhookEndpointsRepository,
    WebhookSecretService,
    WebhookDispatcher,
    {
      provide: ENVELOPE_CIPHER,
      useFactory: () =>
        new KmsEnvelopeCipher(
          process.env['KMS_WEBHOOK_KEY_ARN'] ?? 'arn:aws:kms:us-east-1:000000000000:key/placeholder',
        ),
    },
  ],
  exports: [WebhookEndpointsService, WebhookDispatcher],
})
export class WebhooksModule {}
