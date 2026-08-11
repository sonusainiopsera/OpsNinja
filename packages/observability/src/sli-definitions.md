# Jira Integration SLI Definitions (WO-059)

This document is the single source of truth for all Jira integration Service Level
Indicators. Alert rules, dashboards and runbooks are authored from these definitions.
Every metric listed here is emitted with `tenant_id` and `connection_id` labels only
(never issue key, user id, ticket id or link id) to keep time-series cardinality bounded.

---

## SLI Catalogue

### 1. `jira_inbound_lag_ms` — Inbound Sync Lag

| Field       | Value |
|-------------|-------|
| **Name**    | `jira_inbound_lag_ms` |
| **Kind**    | Histogram |
| **Unit**    | Milliseconds (`ms`) |
| **Labels**  | `tenant_id`, `connection_id` |
| **Source**  | `apps/jira-sync-worker` inbound handler, measured from `jira_webhook_events.received_at` to ticket mutation commit |
| **Description** | Time between Jira webhook receipt (persisted to `jira_webhook_events`) and the commit of the resulting OpsNinja ticket mutation. |
| **Target threshold** | p95 ≤ 10 000 ms |
| **Alert** | p95 > 10 000 ms for 5 consecutive minutes → PagerDuty P2 |

---

### 2. `jira_outbound_lag_ms` — Outbound Sync Lag

| Field       | Value |
|-------------|-------|
| **Name**    | `jira_outbound_lag_ms` |
| **Kind**    | Histogram |
| **Unit**    | Milliseconds (`ms`) |
| **Labels**  | `tenant_id`, `connection_id` |
| **Source**  | `apps/jira-sync-worker` outbound handler, measured from `outbox_events.created_at` to Jira API 2xx response |
| **Description** | Time between OpsNinja outbox event creation and the Jira API returning a successful 2xx response. |
| **Target threshold** | p95 ≤ 10 000 ms |
| **Alert** | p95 > 10 000 ms for 5 consecutive minutes → PagerDuty P2 |

---

### 3. `jira_events_total` — Event Outcome Counter

| Field       | Value |
|-------------|-------|
| **Name**    | `jira_events_total` |
| **Kind**    | Counter |
| **Unit**    | `{event}` |
| **Labels**  | `tenant_id`, `connection_id`, `direction` (`inbound`\|`outbound`), `outcome` (`success`\|`failed`\|`skipped`\|`rate_limited`\|`dlq`), `reason` (free-text, low-cardinality) |
| **Source**  | Both inbound and outbound handlers in `apps/jira-sync-worker` |
| **Description** | Total Jira sync events processed, partitioned by direction, outcome and reason. Used for error-rate SLO calculation. |
| **Target threshold** | Error rate (outcome=`failed` / total) ≤ 0.5% over any 1-hour window |
| **Alert** | Error rate > 0.5% for 15 consecutive minutes → PagerDuty P3 |

---

### 4. `jira_dlq_depth` — DLQ Depth

| Field       | Value |
|-------------|-------|
| **Name**    | `jira_dlq_depth` |
| **Kind**    | Gauge |
| **Unit**    | `{item}` |
| **Labels**  | `tenant_id`, `connection_id` |
| **Source**  | `apps/jira-sync-worker` / health service polling `jira_sync_dlq` |
| **Description** | Current count of unresolved failed link events in the Jira sync DLQ. |
| **Target threshold** | Sustained depth ≤ 5 items per connection |
| **Alert** | Depth > 5 for 10 consecutive minutes → PagerDuty P3 |

---

### 5. `jira_rate_limited_total` — Rate Limit Rejections

| Field       | Value |
|-------------|-------|
| **Name**    | `jira_rate_limited_total` |
| **Kind**    | Counter |
| **Unit**    | `{call}` |
| **Labels**  | `tenant_id`, `connection_id` |
| **Source**  | `JiraRateLimiter.tryConsume()` in `apps/jira-sync-worker` |
| **Description** | Total Jira API calls rejected by the per-tenant Redis token bucket. Sustained elevation indicates under-provisioned rate budget. |
| **Target threshold** | No absolute threshold; monitor trend. > 100 rejections/min sustained → investigate |
| **Alert** | Rate > 100/min for 5 consecutive minutes → PagerDuty P3 |

---

### 6. `jira_signature_failures_total` — Webhook Signature Failures

| Field       | Value |
|-------------|-------|
| **Name**    | `jira_signature_failures_total` |
| **Kind**    | Counter |
| **Unit**    | `{request}` |
| **Labels**  | `tenant_id`, `connection_id` |
| **Source**  | `apps/jira-webhook-receiver` signature verifier |
| **Description** | Total Jira webhook requests rejected due to HMAC-SHA256 signature mismatch. Spike may indicate secret rotation in progress or an attack. |
| **Target threshold** | Failure rate ≤ 0.1% of total inbound webhook requests |
| **Alert** | > 10 failures in any 5-minute window → PagerDuty P2 (possible credential leak) |

---

### 7. `jira_recon_drift_total` — Reconciliation Drift Detections

| Field       | Value |
|-------------|-------|
| **Name**    | `jira_recon_drift_total` |
| **Kind**    | Counter |
| **Unit**    | `{issue}` |
| **Labels**  | `tenant_id`, `connection_id`, `drift_field` (`status`\|`assignee`\|`updated_at`) |
| **Source**  | `ReconciliationJob` in `apps/jira-sync-worker` |
| **Description** | Total drift instances detected per run, by field. Persistent high drift for a connection indicates the webhook path is broken. |
| **Target threshold** | No absolute threshold; monitor trend. > 50 drifts/run sustained → investigate webhook health |
| **Alert** | > 50 drifts in a single run → PagerDuty P3 |

---

### 8. `jira_token_refresh_failures_total` — OAuth Token Refresh Failures

| Field       | Value |
|-------------|-------|
| **Name**    | `jira_token_refresh_failures_total` |
| **Kind**    | Counter |
| **Unit**    | `{attempt}` |
| **Labels**  | `tenant_id`, `connection_id` |
| **Source**  | `JiraTokenProvider` in `apps/api` and `apps/jira-sync-worker` |
| **Description** | Total failed attempts to refresh an Atlassian OAuth access token. Typically caused by revoked credentials or Atlassian outage. |
| **Target threshold** | ≤ 3 consecutive failures per connection before alerting |
| **Alert** | > 3 consecutive failures per connection → PagerDuty P2 (connection degraded) |

---

## SLO Summary

| SLI | Target | Window | Severity |
|-----|--------|--------|----------|
| Inbound lag p95 | ≤ 10 s | 5 min | P2 |
| Outbound lag p95 | ≤ 10 s | 5 min | P2 |
| Event error rate | ≤ 0.5% | 1 hr | P3 |
| DLQ depth | ≤ 5 items sustained | 10 min | P3 |
| Rate limit rejections | ≤ 100/min sustained | 5 min | P3 |
| Signature failure rate | ≤ 0.1% | 5 min | P2 |
| Recon drift per run | ≤ 50 | per run | P3 |
| Token refresh failures | ≤ 3 consecutive | — | P2 |

---

## Label Cardinality Policy

Labels **allowed**: `tenant_id`, `connection_id`, `outcome`, `reason`, `direction`, `drift_field`

Labels **banned** (never use as metric labels):
- `issue_key` / `jira_issue_id` — unbounded
- `user_id` / `actor_id` — unbounded
- `ticket_id` / `link_id` — unbounded
- Any free-form text field

Violating the cardinality policy causes time-series explosion in Prometheus and
must be caught in code review before merge.
