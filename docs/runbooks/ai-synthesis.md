# AI Synthesis Worker — Operator Runbook

**Owners:** Platform Engineering  
**Alert rules:** `packages/observability/alerts/ai-synthesis.rules.yaml`  
**Admin API:** `GET /api/v1/admin/ai-synthesis/failures`

---

## Overview

The `ai-synthesis` worker consumes `ticket.resolved` events from SQS, calls AWS
Bedrock to generate a crux + resolution summary, and writes the result back to
`ticket_ai_summaries`. Failures are bounded at **3 attempts** (matching the SQS
`maxReceiveCount` redrive policy). Permanently failed tickets retain their
`resolved` status and remain fully usable — AI summary is a non-blocking
enrichment.

---

## Alert Playbooks

### `AiSynthesisDlqNonEmpty` — DLQ has messages

**Severity:** Warning  
**SLO impact:** Failed summaries accumulate; no ticket functionality is blocked.

**Steps:**

1. Check how many messages are in the DLQ:
   ```
   aws sqs get-queue-attributes \
     --queue-url $AI_SYNTHESIS_DLQ_URL \
     --attribute-names ApproximateNumberOfMessagesVisible
   ```

2. Inspect a sample message body to identify the failure pattern:
   ```
   aws sqs receive-message \
     --queue-url $AI_SYNTHESIS_DLQ_URL \
     --max-number-of-messages 1 \
     --visibility-timeout 30
   ```

3. Query the admin failures endpoint for the affected tenant (get tenant auth
   token from your admin credentials):
   ```
   curl -H "Authorization: Bearer $TOKEN" \
     "$API_URL/api/v1/admin/ai-synthesis/failures?limit=20"
   ```

4. Identify the `lastErrorCode` pattern:
   - `LLM_RETRYABLE_ERROR` — transient Bedrock issue; redrive when provider recovers.
   - `CONTENT_POLICY_VIOLATION` — ticket content blocked by AI provider; review content policy.
   - `INVALID_MODEL_OUTPUT` — model returned unparseable output; may require prompt change.
   - `TICKET_NOT_FOUND` — ticket was deleted between resolution and synthesis; safe to delete DLQ message.
   - `RECONCILIATION_CAP_REACHED` — set by reconciliation job; row was already at cap.

5. Once the root cause is fixed, redrive messages back to the main queue:
   ```
   aws sqs start-message-move-task \
     --source-arn $AI_SYNTHESIS_DLQ_ARN \
     --destination-arn $AI_SYNTHESIS_QUEUE_ARN
   ```

---

### `AiSynthesisLowSuccessRate` — Success rate < 95%

**Severity:** Warning  
**SLO impact:** Tickets resolved during the window lack AI summaries.

**Steps:**

1. Check the metric breakdown by `error_code`:
   ```
   # PromQL
   sum by (error_code) (
     rate(ai_synthesis_attempts_total{outcome="failed_permanent"}[30m])
   )
   ```

2. If `LLM_RETRYABLE_ERROR` is dominant, check the Bedrock service health dashboard.

3. If a specific `tenantId` is dominant, use the admin failures API to isolate:
   ```
   curl -H "Authorization: Bearer $TOKEN" \
     "$API_URL/api/v1/admin/ai-synthesis/failures"
   ```

4. If the failure rate is tenant-wide and related to budget exhaustion, check
   the AI usage admin API:
   ```
   curl -H "Authorization: Bearer $TOKEN" \
     "$API_URL/api/v1/admin/ai/usage"
   ```

---

### `AiSynthesisHighStuckCount` — > 10 rows stuck in pending/running

**Severity:** Warning

**Steps:**

1. Check if the reconciliation job is running by looking for its log output:
   ```
   kubectl logs -l app=ai-synthesis-worker --since=10m | grep "ReconciliationJob"
   ```

2. If the reconciliation job is healthy but the count keeps rising, the worker
   may have crashed mid-inference and left many rows in `running`. The
   reconciliation job will heal these within `AI_RECON_RUNNING_STALE_MINUTES`
   (default 15 min).

3. To force immediate reconciliation, restart the worker pod:
   ```
   kubectl rollout restart deployment/ai-synthesis-worker
   ```

---

## Force Re-synthesis for a Specific Ticket

Use this when a ticket's summary failed and you want to trigger a new synthesis
attempt **without bumping `attempt_count`** (operator-initiated re-synthesis
should not count against the retry cap).

1. Reset the row in the database (requires DB access via the ops toolbox — not
   a BYPASSRLS role; the RLS policy uses `app.current_tenant` which is set by the
   ops procedure):
   ```sql
   -- Run via the tenant-scoped ops procedure, not as superuser
   SELECT ops.reset_ai_summary_for_retry(
     p_tenant_id := '<tenant-uuid>',
     p_ticket_id := '<ticket-uuid>'
   );
   ```
   This sets `ai_status = 'pending'`, `attempt_count = 0`, `last_error_code = NULL`.

2. Publish a new `ticket.resolved` event to the synthesis queue:
   ```
   aws sqs send-message \
     --queue-url $AI_SYNTHESIS_QUEUE_URL \
     --message-body '{"eventId":"<new-uuid>","eventType":"ticket.resolved","tenantId":"<tenant>","ticketId":"<ticket>","occurredAt":"<iso-timestamp>"}'
   ```

3. Monitor the `ticket_ai_summaries` row until `ai_status = 'succeeded'`.

---

## Tenant Safety During Recovery

When redriving DLQ messages or performing forced re-synthesis:

- **Never use `BYPASSRLS`**: all DB operations must go through the tenant-scoped
  `app.current_tenant` session variable so RLS policies remain in effect.
- **Verify tenant scope**: before redriving a batch, confirm all DLQ messages
  belong to the intended tenant by inspecting the `tenantId` field in each
  message body.
- **No cross-tenant writes**: the SynthesisService always sets
  `SET LOCAL app.current_tenant = $tenantId` at the start of every transaction.
  Redriving a message with a different `tenantId` than the original will cause
  the RLS policy to block the read of the original ticket data, returning a
  "not found" outcome rather than writing to the wrong tenant.
- **Audit trail**: all terminal failure state transitions write an
  `ai.synthesis.failed` event to `outbox_events`. Recovery actions should also
  be logged via the standard audit endpoint.

---

## SQS Queue Configuration Reference

| Parameter          | Value             | Notes                                   |
|--------------------|-------------------|-----------------------------------------|
| `maxReceiveCount`  | 3                 | Matches `MAX_ATTEMPTS` in the worker    |
| Visibility timeout | 120 s             | > 30 s inference + retry overhead       |
| DLQ name           | `ai-synthesis-dlq`| `ApproximateNumberOfMessagesVisible > 0` triggers alert |

---

## Related Links

- Alert rules: `packages/observability/alerts/ai-synthesis.rules.yaml`
- Admin failures endpoint: `GET /api/v1/admin/ai-synthesis/failures`
- AI usage endpoint: `GET /api/v1/admin/ai/usage`
- AI settings endpoint: `PUT /api/v1/admin/ai/settings`
