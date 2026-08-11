import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@opsninja/shared';
import { ConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { RequestContextMiddleware } from './observability/request-context';
import {
  serializeRequest,
  serializeError,
  createLogMethodHook,
  PINO_REDACT_PATHS,
} from './observability/log-redactor';
import { IdentityModule } from './modules/identity/identity.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { TicketsModule } from './modules/tickets/tickets.module';
import { SlaModule } from './modules/sla/sla.module';
import { ViewsModule } from './modules/views/views.module';
import { ReportingModule } from './modules/reporting/reporting.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';

@Module({
  imports: [
    // ── Configuration (must be first — all other modules depend on ConfigService) ──
    ConfigModule,

    // ── Structured JSON logging with PII redaction ────────────────────────────
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<Env, true>) => ({
        pinoHttp: {
          level: configService.get('LOG_LEVEL', { infer: true }),
          autoLogging: true,
          customAttributeKeys: {
            responseTime: 'duration_ms',
          },
          serializers: {
            req: (req: Record<string, unknown>) => serializeRequest(req),
            err: (err: Record<string, unknown>) => serializeError(err),
          },
          hooks: {
            logMethod: createLogMethodHook(),
          },
          redact: {
            paths: [...PINO_REDACT_PATHS],
            censor: '[REDACTED]',
          },
          // In development use pretty printing; in production emit pure JSON
          transport:
            configService.get('NODE_ENV', { infer: true }) !== 'production'
              ? { target: 'pino-pretty', options: { colorize: true, singleLine: true } }
              : undefined,
        },
      }),
    }),

    // ── Observability ─────────────────────────────────────────────────────────
    HealthModule,

    // ── Domain modules (empty seams — domain logic added in subsequent WOs) ────
    IdentityModule,
    OrganizationsModule,
    TicketsModule,
    SlaModule,
    ViewsModule,
    ReportingModule,
    IntegrationsModule,
  ],
})
export class AppModule implements NestModule {
  /**
   * Register the RequestContextMiddleware as the FIRST middleware so that
   * every downstream handler (interceptors, guards, filters, services)
   * has access to the traceId via `RequestContextService.getTraceId()`.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestContextMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
