/**
 * AiPolicy port — injectable interface for per-tenant AI enablement checks.
 *
 * WO-063 will supply the real budget/opt-out implementation.
 * This permissive default allows synthesis to proceed for all tenants until
 * the real policy service is wired in.
 */

export const AI_POLICY = 'AI_POLICY';

export interface AiPolicyPort {
  /**
   * Returns 'allow' to proceed with inference, 'skip' to short-circuit
   * with ai_status = 'skipped' without calling the LLM.
   */
  check(tenantId: string, ticketId: string): Promise<'allow' | 'skip'>;
}

/** Default permissive policy — always allows synthesis. */
export class PermissiveAiPolicy implements AiPolicyPort {
  async check(_tenantId: string, _ticketId: string): Promise<'allow' | 'skip'> {
    return 'allow';
  }
}
