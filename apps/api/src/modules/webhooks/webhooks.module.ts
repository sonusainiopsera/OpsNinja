import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebhookEndpointsController } from './webhook-endpoints.controller';
import { EventCatalogueController } from './event-catalogue.controller';
import { WebhookEndpointsService } from './webhook-endpoints.service';
import { WebhookSecretService } from './webhook-secret.service';
import { WebhookEndpointsRepository } from './webhook-endpoints.repository';
import { ENVELOPE_CIPHER_PORT, KmsEnvelopeCipher } from '@opsninja/crypto';

@Module({
  controllers: [WebhookEndpointsController, EventCatalogueController],
  providers: [
    WebhookEndpointsService,
    WebhookSecretService,
    WebhookEndpointsRepository,
    {
      provide: ENVELOPE_CIPHER_PORT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => new KmsEnvelopeCipher(config),
    },
  ],
  exports: [WebhookEndpointsService],
})
export class WebhooksModule {}
