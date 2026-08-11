/**
 * AiPolicy port — injectable interface for per-tenant AI enablement checks.
 *
 * WO-063 supplies DbAiPolicy as the real implementation.
 * The permissive default is kept for test overrides only.
 */

export const AI_POLICY = 'AI_POLICY';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Machine-readable reason codes for the policy decision. */
export type AiPolicyReason =
  | 'allowed'
  | 'disabled'
  | 'budget_exhausted'
  | 'policy_unavailable';

export interface AiPolicyCheckResult {
  /** 'allow' → proceed with inference; 'skip' → short-circuit. */
  decision: 'allow' | 'skip';
  /** Stable reason code written to last_error_code on skip. */
  reason: AiPolicyReason;
}

export interface TokenUsage {
  inputTokens:  number;
  outputTokens: number;
  modelId:      string;
}

// ---------------------------------------------------------------------------
// Port interface
// ---------------------------------------------------------------------------

export interface AiPolicyPort {
  /**
   * Returns the policy decision for the given tenant.
   * Must never throw — returns { decision: 'skip', reason: 'policy_unavailable' }
   * on any unexpected error so ticket closure is never blocked.
   */
  check(tenantId: string, ticketId: string): Promise<AiPolicyCheckResult>;

  /**
   * Atomically increments the current-period usage aggregate.
   * Failures are logged and swallowed — usage recording must never roll back
   * a successful summary writeback.
   */
  recordUsage(tenantId: string, usage: TokenUsage): Promise<void>;
}

// ---------------------------------------------------------------------------
// Permissive default (tests / before WO-063 wiring)
// ---------------------------------------------------------------------------

/** Always allows; recordUsage is a no-op. */
export class PermissiveAiPolicy implements AiPolicyPort {
  async check(_tenantId: string, _ticketId: string): Promise<AiPolicyCheckResult> {
    return { decision: 'allow', reason: 'allowed' };
  }

  async recordUsage(_tenantId: string, _usage: TokenUsage): Promise<void> {
    // no-op
  }
}
