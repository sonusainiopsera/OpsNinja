'use client';

/**
 * JiraIntegrationPage — Jira Integration Console for admin/integration_admin
 * principals (WO-058).
 *
 * Layout:
 *   1. First-run empty state when no connections configured
 *   2. Connection cards (one per connection)
 *   3. HealthStrip (four metric tiles, 15s polling)
 *   4. MappingEditor (for the active/first connection)
 *   5. WebhookPanel
 *   6. DlqTable
 *   7. ReconciliationPanel
 *
 * Permission: integration:manage gates all write actions. The page itself is
 * reachable only by roles in navConfig.requiredRoles — server rejects API
 * calls with 403 for under-privileged principals.
 */

import React, { useState } from 'react';
import { useJiraHealth, type ApiError } from '../../lib/api/jira/hooks';
import { ConnectionCard } from './ConnectionCard';
import { HealthStrip } from './HealthStrip';
import { MappingEditor } from './MappingEditor';
import { WebhookPanel } from './WebhookPanel';
import { DlqTable } from './DlqTable';
import { ReconciliationPanel } from './ReconciliationPanel';
import type { JiraHealthConnectionInfo } from '../../lib/api/jira/types';

// ---------------------------------------------------------------------------
// Permission-denied panel
// ---------------------------------------------------------------------------

function PermissionDeniedPanel() {
  return (
    <section
      role="alert"
      aria-label="Permission denied"
      style={{
        padding: '48px',
        textAlign: 'center',
        border: '1px solid #fca5a5',
        borderRadius: 8,
        background: '#fef2f2',
        color: '#dc2626',
        marginTop: 32,
      }}
    >
      <p style={{ fontSize: 15, fontWeight: 600, margin: '0 0 8px' }}>
        Access Denied
      </p>
      <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>
        You need the <code>integration:manage</code> or <code>jira:read</code> permission to access
        this page. Contact your administrator.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// First-run empty state (no connections configured yet)
// ---------------------------------------------------------------------------

interface FirstRunProps {
  canWrite: boolean;
  onConnect: () => void;
}

function FirstRunEmptyState({ canWrite, onConnect }: FirstRunProps) {
  return (
    <section
      aria-label="No Jira connection configured"
      style={{
        padding: '64px 32px',
        textAlign: 'center',
        border: '1px dashed var(--color-border, #d1d5db)',
        borderRadius: 8,
        background: 'var(--color-bg-card, #fff)',
        marginTop: 32,
      }}
    >
      <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-fg-primary, #111827)', margin: '0 0 8px' }}>
        No Jira integration configured
      </p>
      <p style={{ fontSize: 13, color: 'var(--color-fg-muted, #6b7280)', margin: '0 0 24px' }}>
        Connect your Jira workspace to enable ticket escalation, sync and
        mapping for your OpsNinja tenant.
      </p>
      {canWrite && (
        <button
          type="button"
          onClick={onConnect}
          aria-label="Connect Jira workspace"
          style={{
            padding: '8px 24px',
            borderRadius: 6,
            border: 'none',
            background: 'var(--color-primary, #4f46e5)',
            color: '#fff',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Connect Jira
        </button>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

interface JiraIntegrationPageProps {
  canWrite?: boolean;
}

export function JiraIntegrationPage({ canWrite = false }: JiraIntegrationPageProps) {
  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const healthQuery = useJiraHealth({
    retry: (count, err) => {
      if ((err as ApiError).status === 403) {
        setForbidden(true);
        return false;
      }
      return count < 2;
    },
  });

  const health = healthQuery.data;
  const healthError = healthQuery.error as ApiError | null;
  const isLoading = healthQuery.isLoading;

  // 403 from health endpoint
  if (forbidden || healthError?.status === 403) {
    return (
      <div style={{ padding: '24px 32px' }}>
        <PageHeader />
        <PermissionDeniedPanel />
      </div>
    );
  }

  const connections: JiraHealthConnectionInfo[] = health?.connections ?? [];
  const hasConnections = connections.length > 0;
  const isStale = Boolean(health?.stale) ||
    (health ? Date.now() - new Date(health.cachedAt).getTime() > 30_000 : false);

  const effectiveConnectionId =
    activeConnectionId ?? (connections[0]?.id ?? null);

  function handleConnect() {
    // Redirect to the OAuth initiation endpoint
    window.location.href = '/api/v1/integrations/jira/oauth/start';
  }

  function handleReconnect(connectionId: string) {
    window.location.href = `/api/v1/integrations/jira/connections/${connectionId}/reconnect`;
  }

  const activeConnection = connections.find((c) => c.id === effectiveConnectionId) ?? null;

  return (
    <div
      style={{ padding: '24px 32px', maxWidth: 1100, margin: '0 auto' }}
      aria-label="Jira Integration Console"
    >
      <PageHeader />

      {/* Loading skeleton */}
      {isLoading && (
        <p aria-live="polite" style={{ color: 'var(--color-fg-muted, #6b7280)', fontSize: 14, marginTop: 24 }}>
          Loading Jira integration status…
        </p>
      )}

      {/* First-run empty state */}
      {!isLoading && !hasConnections && (
        <FirstRunEmptyState canWrite={canWrite} onConnect={handleConnect} />
      )}

      {/* Console panels — shown only when connections exist */}
      {hasConnections && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, marginTop: 24 }}>
          {/* Connection picker tabs (when multiple connections) */}
          {connections.length > 1 && (
            <nav aria-label="Jira connections" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {connections.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setActiveConnectionId(c.id)}
                  aria-pressed={effectiveConnectionId === c.id}
                  style={{
                    padding: '5px 14px',
                    borderRadius: 5,
                    border: '1px solid var(--color-border, #e5e7eb)',
                    background: effectiveConnectionId === c.id ? 'var(--color-primary, #4f46e5)' : '#fff',
                    color: effectiveConnectionId === c.id ? '#fff' : 'var(--color-fg-primary, #111827)',
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  {c.siteUrl}
                </button>
              ))}
            </nav>
          )}

          {/* Active connection card */}
          {activeConnection && (
            <ConnectionCard
              connection={activeConnection}
              canWrite={canWrite}
              onReconnect={handleReconnect}
            />
          )}

          {/* Health strip */}
          <HealthStrip
            health={health}
            isLoading={isLoading}
            error={healthError}
          />

          {/* Mapping editor */}
          {activeConnection && (
            <section aria-label="Project mapping editor">
              <h2
                style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-fg-primary, #111827)', margin: '0 0 12px' }}
              >
                Mapping Configuration
              </h2>
              <MappingEditor
                connectionId={activeConnection.id}
                mapping={null}
                canWrite={canWrite}
                onSaved={() => void healthQuery.refetch()}
              />
            </section>
          )}

          {/* Webhook panel */}
          {activeConnection && (
            <WebhookPanel
              webhook={health?.webhook}
              connectionId={activeConnection.id}
              webhookUrl={null}
              canWrite={canWrite}
              stale={isStale}
            />
          )}

          {/* DLQ table */}
          <DlqTable
            connectionId={effectiveConnectionId ?? undefined}
            canWrite={canWrite}
            stale={isStale}
          />

          {/* Reconciliation panel */}
          <ReconciliationPanel
            connectionId={effectiveConnectionId}
            canWrite={canWrite}
            stale={isStale}
          />
        </div>
      )}
    </div>
  );
}

function PageHeader() {
  return (
    <header style={{ marginBottom: 4 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-fg-primary, #111827)', margin: '0 0 4px' }}>
        Jira Integration
      </h1>
      <p style={{ fontSize: 13, color: 'var(--color-fg-muted, #6b7280)', margin: 0 }}>
        Manage connections, mappings, sync health and dead-letter queue replay.
      </p>
    </header>
  );
}
