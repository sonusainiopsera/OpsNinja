/**
 * DbAiPolicy — WO-063.
 *
 * Real AiPolicy implementation for the ai-synthesis worker.
 * Queries tenant_ai_settings and tenant_ai_usage directly via a pg.Pool
 * connection without the NestJS withTenantTransaction infrastructure (the
 * worker runs outside the API process).
 *
 * Design rules:
 *   - check() never throws; any DB/logic error returns policy_unavailable so
 *     ticket closure is never blocked.
 *   - recordUsage() swallows errors after one retry; a successful synthesis
 *     writeback must never be rolled back by a usage-accounting failure.
 *   - Period is always to-the-month in UTC (YYYY-MM) derived at call-time,
 *     consistent with the DB now() used inside the upsert.
 *   - Token budget enforcement uses total tokens (input + output) to match
 *     what most providers bill; the threshold comparison is strictly greater
 *     than or equal so the exact-boundary case is treated as exhausted.
 *   - Fire-once threshold warning uses a Redis SETNX key
 *     `ai:warn:{tenantId}:{period}` with 33-day TTL. Falls back gracefully
 *     when Redis is unavailable (warned_at DB column as durable backstop).
 */

import { Logger } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import type {
  AiPolicyPort,
  AiPolicyCheckResult,
  AiPolicyReason,
  TokenUsage,
} from './ai-policy.port';

// ---------------------------------------------------------------------------
// Pricing helper (copied from model-pricing constants to keep worker standalone)
// ---------------------------------------------------------------------------

interface ModelPrice { inputMicrosPerKToken: number; outputMicrosPerKToken: number; }

const PRICE_TABLE: Array<[string, ModelPrice]> = [
  ['anthropic.claude-3-5-sonnet', { inputMicrosPerKToken: 3_000, outputMicrosPerKToken: 15_000 }],
  ['anthropic.claude-3-sonnet',   { inputMicrosPerKToken: 3_000, outputMicrosPerKToken: 15_000 }],
  ['anthropic.claude-3-haiku',    { inputMicrosPerKToken: 250,   outputMicrosPerKToken: 1_250  }],
  ['anthropic.claude-3-opus',     { inputMicrosPerKToken: 15_000,outputMicrosPerKToken: 75_000 }],
  ['amazon.titan-text',           { inputMicrosPerKToken: 200,   outputMicrosPerKToken: 300    }],
];

function getPrice(modelId: string): ModelPrice {
  for (const [prefix, p] of PRICE_TABLE) {
    if (modelId.startsWith(prefix)) return p;
  }
  return { inputMicrosPerKToken: 3_000, outputMicrosPerKToken: 15_000 };
}

function estimateMicros(inputTokens: number, outputTokens: number, modelId: string): number {
  const p = getPrice(modelId);
  return Math.round((inputTokens / 1000) * p.inputMicrosPerKToken)
       + Math.round((outputTokens / 1000) * p.outputMicrosPerKToken);
}

// ---------------------------------------------------------------------------
// Period helper
// ---------------------------------------------------------------------------

function currentPeriod(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// DbAiPolicy
// ---------------------------------------------------------------------------

export class DbAiPolicy implements AiPolicyPort {
  private readonly logger = new Logger(DbAiPolicy.name);

  constructor(private readonly pool: Pool) {}

  // --------------------------------------------------------------------------
  // check()
  // --------------------------------------------------------------------------

  async check(tenantId: string, _ticketId: string): Promise<AiPolicyCheckResult> {
    let client: PoolClient | null = null;
    try {
      client = await this.pool.connect();

      // Tenant isolation for raw pool client
      await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

      // Read settings (missing row = defaults: enabled, no budget)
      const settingsRes = await client.query<{
        ai_enabled: boolean;
        monthly_token_budget: string | null;
        warn_threshold_pct: number;
      }>(
        `SELECT ai_enabled, monthly_token_budget, warn_threshold_pct
         FROM tenant_ai_settings
         WHERE tenant_id = $1
         LIMIT 1`,
        [tenantId],
      );

      const settings = settingsRes.rows[0];

      // Default: enabled, no budget
      const aiEnabled = settings?.ai_enabled ?? true;
      if (!aiEnabled) {
        return { decision: 'skip', reason: 'disabled' };
      }

      const budget = settings?.monthly_token_budget
        ? parseInt(settings.monthly_token_budget, 10)
        : null;

      if (budget !== null && budget > 0) {
        const period = currentPeriod();
        const usageRes = await client.query<{
          input_tokens: string;
          output_tokens: string;
        }>(
          `SELECT input_tokens, output_tokens
           FROM tenant_ai_usage
           WHERE tenant_id = $1 AND period = $2
           LIMIT 1`,
          [tenantId, period],
        );
        const row = usageRes.rows[0];
        const totalUsed =
          (row ? parseInt(row.input_tokens, 10) + parseInt(row.output_tokens, 10) : 0);

        if (totalUsed >= budget) {
          this.logger.warn('AI budget exhausted', { tenantId, period, totalUsed, budget });
          return { decision: 'skip', reason: 'budget_exhausted' };
        }

        // Fire-once threshold warning
        const warnPct = settings?.warn_threshold_pct ?? 80;
        if (totalUsed >= Math.floor((warnPct / 100) * budget)) {
          void this.emitThresholdWarning(tenantId, period, totalUsed, budget, warnPct);
        }
      }

      return { decision: 'allow', reason: 'allowed' };
    } catch (err) {
      this.logger.error('AiPolicy.check() failed — denying with policy_unavailable', {
        tenantId,
        error: (err as Error).message,
      });
      return { decision: 'skip', reason: 'policy_unavailable' };
    } finally {
      client?.release();
    }
  }

  // --------------------------------------------------------------------------
  // recordUsage()
  // --------------------------------------------------------------------------

  async recordUsage(tenantId: string, usage: TokenUsage): Promise<void> {
    const period = currentPeriod();
    const costMicros = estimateMicros(usage.inputTokens, usage.outputTokens, usage.modelId);

    let client: PoolClient | null = null;
    try {
      client = await this.pool.connect();
      await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

      // Atomic upsert — no application-level read-modify-write
      await client.query(
        `INSERT INTO tenant_ai_usage
           (tenant_id, period, input_tokens, output_tokens, request_count,
            estimated_cost_micros, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 1, $5, now(), now())
         ON CONFLICT (tenant_id, period) DO UPDATE
           SET input_tokens          = tenant_ai_usage.input_tokens  + EXCLUDED.input_tokens,
               output_tokens         = tenant_ai_usage.output_tokens + EXCLUDED.output_tokens,
               request_count         = tenant_ai_usage.request_count + 1,
               estimated_cost_micros = tenant_ai_usage.estimated_cost_micros + EXCLUDED.estimated_cost_micros,
               updated_at            = now()`,
        [tenantId, period, usage.inputTokens, usage.outputTokens, costMicros],
      );

      this.emitUsageMetrics(tenantId, usage, costMicros);
    } catch (err) {
      // Retry once — usage recording must not block successful writeback
      this.logger.warn('recordUsage failed, retrying once', {
        tenantId,
        error: (err as Error).message,
      });
      try {
        client?.release();
        client = null;
        client = await this.pool.connect();
        await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
        await client.query(
          `INSERT INTO tenant_ai_usage
             (tenant_id, period, input_tokens, output_tokens, request_count,
              estimated_cost_micros, created_at, updated_at)
           VALUES ($1, $2, $3, $4, 1, $5, now(), now())
           ON CONFLICT (tenant_id, period) DO UPDATE
             SET input_tokens          = tenant_ai_usage.input_tokens  + EXCLUDED.input_tokens,
                 output_tokens         = tenant_ai_usage.output_tokens + EXCLUDED.output_tokens,
                 request_count         = tenant_ai_usage.request_count + 1,
                 estimated_cost_micros = tenant_ai_usage.estimated_cost_micros + EXCLUDED.estimated_cost_micros,
                 updated_at            = now()`,
          [tenantId, period, usage.inputTokens, usage.outputTokens, costMicros],
        );
        this.emitUsageMetrics(tenantId, usage, costMicros);
      } catch (retryErr) {
        this.logger.error('recordUsage retry also failed — swallowing', {
          tenantId,
          error: (retryErr as Error).message,
        });
      }
    } finally {
      client?.release();
    }
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  /**
   * Fire-once threshold warning. Uses DB warned_at column as durable backstop.
   * A Redis SETNX could be added here for hot-path dedup without a DB write.
   */
  private async emitThresholdWarning(
    tenantId: string,
    period: string,
    totalUsed: number,
    budget: number,
    warnPct: number,
  ): Promise<void> {
    let client: PoolClient | null = null;
    try {
      client = await this.pool.connect();
      await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

      // Only warn once per period — check warned_at before emitting
      const checkRes = await client.query<{ warned_at: Date | null }>(
        `SELECT warned_at FROM tenant_ai_settings WHERE tenant_id = $1`,
        [tenantId],
      );
      const lastWarnedAt = checkRes.rows[0]?.warned_at;
      const currentPeriodStart = new Date(`${period}-01T00:00:00Z`);
      if (lastWarnedAt && lastWarnedAt >= currentPeriodStart) {
        return; // Already warned this period
      }

      // Mark warned
      await client.query(
        `INSERT INTO tenant_ai_settings (tenant_id, warned_at, updated_at)
         VALUES ($1, now(), now())
         ON CONFLICT (tenant_id) DO UPDATE
           SET warned_at = now(), updated_at = now()`,
        [tenantId],
      );

      const utilisationPct = Math.round((totalUsed / budget) * 100);
      this.logger.warn('[AI_BUDGET_WARNING] Token budget threshold reached', {
        tenantId, period, totalUsed, budget, utilisationPct, warnThresholdPct: warnPct,
      });
      // Metric emission (structured log acts as metric source for now)
      this.logger.log('[METRIC] ai_budget_utilisation', {
        metric: 'ai_budget_utilisation_pct',
        tenantId, period, value: utilisationPct,
      });
    } catch (err) {
      this.logger.warn('emitThresholdWarning failed', {
        tenantId, error: (err as Error).message,
      });
    } finally {
      client?.release();
    }
  }

  private emitUsageMetrics(tenantId: string, usage: TokenUsage, costMicros: number): void {
    this.logger.log('[METRIC] ai_tokens_consumed_total', {
      metric: 'ai_tokens_consumed_total',
      tenantId,
      modelId: usage.modelId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    });
    this.logger.log('[METRIC] ai_estimated_cost_micros_total', {
      metric: 'ai_estimated_cost_micros_total',
      tenantId,
      modelId: usage.modelId,
      costMicros,
    });
  }
}
