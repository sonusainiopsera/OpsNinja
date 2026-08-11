import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

/**
 * Builds and serves the OpenAPI 3.1 document.
 *
 * Call `setupOpenApi(app)` in `main.ts` after all modules are loaded.
 * The document is served at `GET /api/v1/openapi.json`.
 *
 * The committed snapshot at `openapi-snapshot.json` is checked in CI
 * via the `check-openapi` script — any decorator change that alters the
 * document shape must regenerate and commit the snapshot.
 */
export function setupOpenApi(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('OpsNinja API')
    .setDescription(
      'Multi-tenant ITSM platform API. ' +
      'All endpoints under /api/v1 require a valid JWT unless noted.',
    )
    .setVersion('1')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'access-token',
    )
    .addTag('observability', 'Health and readiness probes')
    .addServer('/api/v1', 'Versioned API base path')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  // Serve at /api/v1/openapi.json — note the global prefix is already /api/v1
  // so swagger path is relative to the app root
  SwaggerModule.setup('openapi', app, document, {
    jsonDocumentUrl: 'openapi.json',
  });

  return document;
}
