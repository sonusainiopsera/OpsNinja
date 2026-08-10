import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { validateEnv } from '@opsninja/shared';

/**
 * Application configuration module.
 *
 * Wraps NestJS `ConfigModule` with a Zod `validate` callback so that:
 * 1. All required environment variables are present and well-formed at startup.
 * 2. An empty string is treated the same as a missing variable (fails startup).
 * 3. A clear, actionable error listing every offending key is thrown when
 *    validation fails — the process exits immediately, never partially booted.
 *
 * Registered as `isGlobal: true` so every module can inject `ConfigService`
 * without importing `ConfigModule` individually.
 */
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      // Pass the raw process.env through the Zod validator.
      // NestJS calls `validate(processEnv)` before the application boots.
      validate: (config: Record<string, unknown>) => validateEnv(config),
      // Do not load .env files in production; secrets come from the environment
      // injected by the container orchestrator at runtime.
      ignoreEnvFile: process.env['NODE_ENV'] === 'production',
    }),
  ],
})
export class ConfigModule {}
