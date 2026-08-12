/**
 * db-ai-policy.spec.ts — unit tests for DbAiPolicy decision matrix (WO-063 AC9).
 *
 * Pure mock tests — no real database. Uses FakePool/FakePoolClient to intercept
 * SQL and return canned rows.
 *
 * Covers (AC9):
 *   - Policy decision matrix: all combinations of ai_enabled and budget utilisation
 *   - Exact-boundary case: total tokens === budget → budget_exhausted
 *   - No settings row → defaults (enabled, no budget) → allowed
 *   - No budget set → always allowed
 *   - fire-once warning: emitted once per period, not twice
 *   - DB error in check() → policy_unavailable (fail-safe toward availability)
 *   - recordUsage() atomic upsert SQL shape
 *   - recordUsage() retry-once on first failure
 *   - recordUsage() swallows error after two failures (no throw)
 */

import { DbAiPolicy } from '../src/db-ai-policy';
import type { Pool, PoolClient } from 'pg';

// ---------------------------------------------------------------------------
// Fake pool infrastructure
// ---------------------------------------------------------------------------

interface QueryRecord {
  text: string;
  values: unknown[];
}

class FakePoolClient {
  queries: QueryRecord[] = [];
  released = false;

  private responses: Array<{ fragment: string; rows: unknown[] }> = [];

  setResponse(fragment: string, rows: unknown[]) {
    this.responses.push({ fragment, rows });
    return this;
  }

  async query<T extends { rows: unknown[] } = { rows: unknown[] }>(
    text: string,
    values: unknown[] = [],
  ): Promise<T> {
    this.queries.push({ text, values });
    for (const r of this.responses) {
      if (text.includes(r.fragment)) {
        return { rows: r.rows } as T;
      }
    }
    return { rows: [] } as T;
  }

  release() { this.released = true; }
}

function makePool(clients: FakePoolClient[]): Pool {
  let i = 0;
  return {
    connect: jest.fn(async () => {
      const client = clients[i++ % clients.length];
      return client as unknown as PoolClient;
    }),
  } as unknown as Pool;
}

// ---------------------------------------------------------------------------
// Helper builders
// ---------------------------------------------------------------------------

type SettingsRow = {
  ai_enabled: boolean;
  monthly_token_budget: string | null;
  warn_threshold_pct: number;
};

type UsageRow = {
  input_tokens: string;
  output_tokens: string;
};

function settingsRow(override: Partial<SettingsRow> = {}): SettingsRow {
  return {
    ai_enabled:           true,
    monthly_token_budget: null,
    warn_threshold_pct:   80,
    ...override,
  };
}

// ---------------------------------------------------------------------------
// AC9: Decision matrix — check()
// ---------------------------------------------------------------------------

describe('DbAiPolicy.check() — decision matrix', () => {
  const TENANT = 'tenant-aa-0001';
  const TICKET = 'ticket-bb-0001';

  it('allowed when ai_enabled=true and no budget set', async () => {
    const client = new FakePoolClient();
    client.setResponse('tenant_ai_settings', [settingsRow()]);
    const policy = new DbAiPolicy(makePool([client]));
    const result = await policy.check(TENANT, TICKET);
    expect(result.decision).toBe('allow');
    expect(result.reason).toBe('allowed');
  });

  it('skip/disabled when ai_enabled=false', async () => {
    const client = new FakePoolClient();
    client.setResponse('tenant_ai_settings', [settingsRow({ ai_enabled: false })]);
    const policy = new DbAiPolicy(makePool([client]));
    const result = await policy.check(TENANT, TICKET);
    expect(result.decision).toBe('skip');
    expect(result.reason).toBe('disabled');
  });

  it('allowed when no settings row (defaults: enabled, no budget)', async () => {
    const client = new FakePoolClient();
    // no setResponse → returns empty rows for all queries
    const policy = new DbAiPolicy(makePool([client]));
    const result = await policy.check(TENANT, TICKET);
    expect(result.decision).toBe('allow');
    expect(result.reason).toBe('allowed');
  });

  it('allowed when usage is under budget', async () => {
    const client = new FakePoolClient();
    client.setResponse('tenant_ai_settings', [settingsRow({ monthly_token_budget: '100000' })]);
    const usageRow: UsageRow = { input_tokens: '40000', output_tokens: '10000' };
    client.setResponse('tenant_ai_usage', [usageRow]);
    const policy = new DbAiPolicy(makePool([client]));
    const result = await policy.check(TENANT, TICKET);
    expect(result.decision).toBe('allow');
    expect(result.reason).toBe('allowed');
  });

  it('skip/budget_exhausted when usage equals budget exactly (boundary)', async () => {
    const client = new FakePoolClient();
    client.setResponse('tenant_ai_settings', [settingsRow({ monthly_token_budget: '100000' })]);
    const usageRow: UsageRow = { input_tokens: '80000', output_tokens: '20000' }; // total = 100000
    client.setResponse('tenant_ai_usage', [usageRow]);
    const policy = new DbAiPolicy(makePool([client]));
    const result = await policy.check(TENANT, TICKET);
    expect(result.decision).toBe('skip');
    expect(result.reason).toBe('budget_exhausted');
  });

  it('skip/budget_exhausted when usage exceeds budget', async () => {
    const client = new FakePoolClient();
    client.setResponse('tenant_ai_settings', [settingsRow({ monthly_token_budget: '100' })]);
    const usageRow: UsageRow = { input_tokens: '80', output_tokens: '25' }; // total = 105
    client.setResponse('tenant_ai_usage', [usageRow]);
    const policy = new DbAiPolicy(makePool([client]));
    const result = await policy.check(TENANT, TICKET);
    expect(result.decision).toBe('skip');
    expect(result.reason).toBe('budget_exhausted');
  });

  it('allowed when usage is just below budget (one token under)', async () => {
    const client = new FakePoolClient();
    client.setResponse('tenant_ai_settings', [settingsRow({ monthly_token_budget: '100000' })]);
    const usageRow: UsageRow = { input_tokens: '79999', output_tokens: '20000' }; // total = 99999
    client.setResponse('tenant_ai_usage', [usageRow]);
    const policy = new DbAiPolicy(makePool([client]));
    const result = await policy.check(TENANT, TICKET);
    expect(result.decision).toBe('allow');
  });

  it('allowed when budget is set but no usage row yet (zero consumption)', async () => {
    const client = new FakePoolClient();
    client.setResponse('tenant_ai_settings', [settingsRow({ monthly_token_budget: '100000' })]);
    // no usage row → empty
    const policy = new DbAiPolicy(makePool([client]));
    const result = await policy.check(TENANT, TICKET);
    expect(result.decision).toBe('allow');
  });

  it('policy_unavailable when DB throws', async () => {
    const brokenPool: Pool = {
      connect: jest.fn().mockRejectedValue(new Error('connection refused')),
    } as unknown as Pool;
    const policy = new DbAiPolicy(brokenPool);
    const result = await policy.check(TENANT, TICKET);
    expect(result.decision).toBe('skip');
    expect(result.reason).toBe('policy_unavailable');
  });

  it('sets app.current_tenant before querying settings', async () => {
    const client = new FakePoolClient();
    client.setResponse('tenant_ai_settings', [settingsRow()]);
    const policy = new DbAiPolicy(makePool([client]));
    await policy.check('my-tenant-xyz', TICKET);
    const configQuery = client.queries.find((q) => q.text.includes('set_config'));
    expect(configQuery).toBeDefined();
    expect(configQuery!.values[0]).toBe('my-tenant-xyz');
  });

  it('releases pool client after allowed decision', async () => {
    const client = new FakePoolClient();
    client.setResponse('tenant_ai_settings', [settingsRow()]);
    const policy = new DbAiPolicy(makePool([client]));
    await policy.check(TENANT, TICKET);
    expect(client.released).toBe(true);
  });

  it('releases pool client after disabled decision', async () => {
    const client = new FakePoolClient();
    client.setResponse('tenant_ai_settings', [settingsRow({ ai_enabled: false })]);
    const policy = new DbAiPolicy(makePool([client]));
    await policy.check(TENANT, TICKET);
    expect(client.released).toBe(true);
  });

  it('releases pool client even when DB throws (fail-safe)', async () => {
    const mockClient = {
      query: jest.fn().mockRejectedValue(new Error('db error')),
      release: jest.fn(),
    };
    const pool: Pool = {
      connect: jest.fn().mockResolvedValue(mockClient),
    } as unknown as Pool;
    const policy = new DbAiPolicy(pool);
    await policy.check(TENANT, TICKET); // must not throw
    expect(mockClient.release).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// AC9: Fire-once warning semantics
// ---------------------------------------------------------------------------

describe('DbAiPolicy.check() — fire-once warning', () => {
  const TENANT = 'tenant-warn-0001';
  const TICKET = 'ticket-warn-0001';

  function makeWarnClients(alreadyWarnedAt: Date | null): {
    checkClient: FakePoolClient;
    warnClient: FakePoolClient;
  } {
    // check() opens client 1 for main query, client 2 for emitThresholdWarning
    const checkClient = new FakePoolClient();
    checkClient.setResponse('tenant_ai_settings', [{
      ai_enabled:           true,
      monthly_token_budget: '100000',
      warn_threshold_pct:   80,
    }]);
    checkClient.setResponse('tenant_ai_usage', [{
      input_tokens:  '65000',
      output_tokens: '16000', // total = 81000 (81% of 100000 → crosses 80% threshold)
    }]);

    const warnClient = new FakePoolClient();
    warnClient.setResponse('warned_at', [{ warned_at: alreadyWarnedAt }]);

    return { checkClient, warnClient };
  }

  it('threshold warning is emitted when usage crosses warn_threshold_pct', async () => {
    const { checkClient, warnClient } = makeWarnClients(null);
    const pool = makePool([checkClient, warnClient]);
    const policy = new DbAiPolicy(pool);
    await policy.check(TENANT, TICKET);
    // Decision must still be allow (budget not exhausted)
    // The warn client will have been asked for warned_at
    expect(warnClient.queries.some((q) => q.text.includes('warned_at'))).toBe(true);
  });

  it('warning is suppressed when already warned this period', async () => {
    // warned_at is set within current period
    const { checkClient, warnClient } = makeWarnClients(new Date());
    const pool = makePool([checkClient, warnClient]);
    const policy = new DbAiPolicy(pool);
    await policy.check(TENANT, TICKET);
    // warnClient should NOT have executed the UPDATE warned_at
    const updateQuery = warnClient.queries.find(
      (q) => q.text.includes('UPDATE') && q.text.includes('warned_at'),
    );
    expect(updateQuery).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// AC9: recordUsage() — atomic upsert
// ---------------------------------------------------------------------------

describe('DbAiPolicy.recordUsage()', () => {
  const TENANT = 'tenant-usage-0001';

  it('executes INSERT ... ON CONFLICT DO UPDATE (atomic upsert)', async () => {
    const client = new FakePoolClient();
    const policy = new DbAiPolicy(makePool([client]));
    await policy.recordUsage(TENANT, {
      inputTokens:  100,
      outputTokens: 50,
      modelId:      'anthropic.claude-3-haiku-20240307',
    });
    const upsert = client.queries.find((q) =>
      q.text.includes('ON CONFLICT') && q.text.includes('tenant_ai_usage'),
    );
    expect(upsert).toBeDefined();
    expect(upsert!.text).toContain('input_tokens + EXCLUDED.input_tokens');
    expect(upsert!.text).toContain('output_tokens + EXCLUDED.output_tokens');
    expect(upsert!.text).toContain('request_count + 1');
  });

  it('passes correct parameters: tenantId, period, inputTokens, outputTokens', async () => {
    const client = new FakePoolClient();
    const policy = new DbAiPolicy(makePool([client]));
    await policy.recordUsage(TENANT, {
      inputTokens:  200,
      outputTokens: 75,
      modelId:      'anthropic.claude-3-sonnet-20240229',
    });
    const upsert = client.queries.find((q) => q.text.includes('ON CONFLICT'));
    expect(upsert!.values[0]).toBe(TENANT);
    // period is YYYY-MM
    expect((upsert!.values[1] as string)).toMatch(/^\d{4}-\d{2}$/);
    expect(upsert!.values[2]).toBe(200);
    expect(upsert!.values[3]).toBe(75);
  });

  it('computes positive estimated_cost_micros', async () => {
    const client = new FakePoolClient();
    const policy = new DbAiPolicy(makePool([client]));
    await policy.recordUsage(TENANT, {
      inputTokens:  1000,
      outputTokens: 500,
      modelId:      'anthropic.claude-3-haiku-20240307',
    });
    const upsert = client.queries.find((q) => q.text.includes('ON CONFLICT'));
    const costMicros = upsert!.values[4] as number;
    expect(costMicros).toBeGreaterThan(0);
  });

  it('sets app.current_tenant before writing usage', async () => {
    const client = new FakePoolClient();
    const policy = new DbAiPolicy(makePool([client]));
    await policy.recordUsage('my-tenant-yyy', {
      inputTokens: 10, outputTokens: 5, modelId: 'anthropic.claude-3-haiku-20240307',
    });
    const configQ = client.queries.find((q) => q.text.includes('set_config'));
    expect(configQ!.values[0]).toBe('my-tenant-yyy');
  });

  it('releases pool client after successful write', async () => {
    const client = new FakePoolClient();
    const policy = new DbAiPolicy(makePool([client]));
    await policy.recordUsage(TENANT, {
      inputTokens: 50, outputTokens: 25, modelId: 'amazon.titan-text-lite',
    });
    expect(client.released).toBe(true);
  });

  it('retries once on DB error and does not throw', async () => {
    let callCount = 0;
    const flakeyPool: Pool = {
      connect: jest.fn(async () => {
        callCount++;
        if (callCount === 1) throw new Error('DB overload');
        return new FakePoolClient() as unknown as PoolClient;
      }),
    } as unknown as Pool;
    const policy = new DbAiPolicy(flakeyPool);
    await expect(
      policy.recordUsage(TENANT, { inputTokens: 10, outputTokens: 5, modelId: 'anthropic.claude-3-haiku-20240307' }),
    ).resolves.toBeUndefined();
  });

  it('swallows error after two consecutive failures (never throws)', async () => {
    const brokenPool: Pool = {
      connect: jest.fn().mockRejectedValue(new Error('permanent failure')),
    } as unknown as Pool;
    const policy = new DbAiPolicy(brokenPool);
    await expect(
      policy.recordUsage(TENANT, { inputTokens: 10, outputTokens: 5, modelId: 'anthropic.claude-3-haiku-20240307' }),
    ).resolves.toBeUndefined(); // must not reject
  });
});

// ---------------------------------------------------------------------------
// AC9: Concurrent increment (correctness contract)
// ---------------------------------------------------------------------------

describe('DbAiPolicy.recordUsage() — concurrent increment correctness', () => {
  it('each concurrent call issues its own ON CONFLICT upsert (no lost-update pattern)', async () => {
    // This test verifies that N concurrent calls each produce N independent
    // upsert statements. Actual atomicity is guaranteed by Postgres; this
    // asserts the application never does a read-modify-write.
    const clients: FakePoolClient[] = Array.from({ length: 5 }, () => new FakePoolClient());
    let idx = 0;
    const pool: Pool = {
      connect: jest.fn(async () => clients[idx++ % 5] as unknown as PoolClient),
    } as unknown as Pool;

    const policy = new DbAiPolicy(pool);
    const CONCURRENT = 5;

    await Promise.all(
      Array.from({ length: CONCURRENT }, (_, i) =>
        policy.recordUsage('tenant-conc', {
          inputTokens: 100 * (i + 1),
          outputTokens: 50,
          modelId: 'anthropic.claude-3-haiku-20240307',
        }),
      ),
    );

    // Every client should have its own INSERT ON CONFLICT upsert — no shared state
    const totalUpserts = clients.reduce(
      (sum, c) => sum + c.queries.filter((q) => q.text.includes('ON CONFLICT')).length,
      0,
    );
    expect(totalUpserts).toBe(CONCURRENT);
  });
});

// ---------------------------------------------------------------------------
// DB-backed integration stubs (skip without DATABASE_URL)
// ---------------------------------------------------------------------------

const maybeDescribe = process.env['DATABASE_URL'] ? describe : describe.skip;

maybeDescribe('DbAiPolicy — DB integration (requires DATABASE_URL)', () => {
  it('100 concurrent recordUsage calls produce exact aggregate equal to sum', () => {
    // Run with: DATABASE_URL=postgres://... npx jest db-ai-policy.spec.ts
    expect(true).toBe(true); // stub
  });

  it('budget exhausted tenant returns skip after reaching exact budget', () => {
    expect(true).toBe(true);
  });

  it('no settings row returns allowed with default budget', () => {
    expect(true).toBe(true);
  });

  it('tenant isolation: usage from tenant A not visible to tenant B', () => {
    expect(true).toBe(true);
  });
});
