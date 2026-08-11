/**
 * WorkerModule — NestJS DI module for the ai-synthesis worker.
 *
 * Provides:
 *   Pool (pg)           — DB connections; SET LOCAL executed per transaction
 *   SynthesisConsumer   — SQS long-poll loop
 *   SynthesisService    — orchestration: guard → running → LLM → writeback
 *   ThreadLoader        — ticket + comment assembly
 *   IdempotencyRepository
 *   BedrockLlmAdapter   — LLM_PROVIDER token
 *   PermissiveAiPolicy  — AI_POLICY token (real policy wired by WO-063)
 */

import { Module, OnModuleInit, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { SynthesisConsumer } from './synthesis.consumer';
import { SynthesisService } from './synthesis.service';
import { ThreadLoader } from './thread-loader';
import { IdempotencyRepository } from './idempotency.repository';
import { BedrockLlmAdapter } from './bedrock-llm.adapter';
import { PermissiveAiPolicy, AI_POLICY } from './ai-policy.port';
import { LLM_PROVIDER } from './llm-provider.port';

const PG_POOL = 'PG_POOL';

function createPool(): Pool {
  return new Pool({
    connectionString: process.env['DATABASE_URL'],
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

@Module({
  providers: [
    // ── Infrastructure ────────────────────────────────────────────────────
    { provide: PG_POOL, useFactory: createPool },

    // ── LLM provider ──────────────────────────────────────────────────────
    { provide: LLM_PROVIDER, useClass: BedrockLlmAdapter },

    // ── AI policy (permissive default; WO-063 supplies real impl) ─────────
    { provide: AI_POLICY, useClass: PermissiveAiPolicy },

    // ── Repositories ──────────────────────────────────────────────────────
    {
      provide: IdempotencyRepository,
      useFactory: (pool: Pool) => new IdempotencyRepository(pool),
      inject: [PG_POOL],
    },

    // ── Thread loader ─────────────────────────────────────────────────────
    {
      provide: ThreadLoader,
      useFactory: (pool: Pool) => new ThreadLoader(pool),
      inject: [PG_POOL],
    },

    // ── SynthesisService ──────────────────────────────────────────────────
    {
      provide: SynthesisService,
      useFactory: (
        pool: Pool,
        threadLoader: ThreadLoader,
        idempotency: IdempotencyRepository,
        llmProvider: BedrockLlmAdapter,
        aiPolicy: PermissiveAiPolicy,
      ) => new SynthesisService(pool, threadLoader, idempotency, llmProvider, aiPolicy),
      inject: [PG_POOL, ThreadLoader, IdempotencyRepository, LLM_PROVIDER, AI_POLICY],
    },

    // ── SQS consumer ──────────────────────────────────────────────────────
    SynthesisConsumer,
  ],
})
export class WorkerModule implements OnModuleInit {
  constructor(
    @Inject(IdempotencyRepository)
    private readonly idempotency: IdempotencyRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    // Prune expired idempotency rows at startup (best-effort)
    void this.idempotency.pruneExpired();
  }
}
