'use client';

/**
 * ScopingPanel — displays agents currently scoped to this organization.
 *
 * Read-only display; assignment is managed by the agent-scopes API
 * (separate admin workflow). Shows a descriptive empty state when no
 * agents are scoped.
 */

import React from 'react';
import { useAgentScopes } from '../../lib/api/organizations/hooks';

interface ScopingPanelProps {
  orgId: string;
}

export function ScopingPanel({ orgId }: ScopingPanelProps) {
  const { data: scopes = [], isLoading, isError } = useAgentScopes(orgId);

  if (isLoading) {
    return (
      <div aria-label="Loading agent scopes" style={{ padding: 24 }}>
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            style={{ height: 44, background: 'var(--color-bg-alt, #f3f4f6)', borderRadius: 4, marginBottom: 8 }}
          />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div role="alert" style={{ padding: 16, color: '#dc2626', fontSize: 13 }}>
        Failed to load agent scopes.
      </div>
    );
  }

  if (scopes.length === 0) {
    return (
      <div
        style={{
          padding: 32,
          textAlign: 'center',
          border: '1px dashed var(--color-border, #e5e7eb)',
          borderRadius: 8,
        }}
      >
        <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>No agents scoped</p>
        <p style={{ fontSize: 13, color: 'var(--color-muted, #6b7280)' }}>
          Agents with access to this organization's tickets will appear here. Assign
          scopes from the user management settings.
        </p>
      </div>
    );
  }

  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--color-muted, #6b7280)', marginBottom: 16 }}>
        The following agents can access tickets for this organization.
      </p>
      <table
        style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}
        aria-label="Scoped agents"
      >
        <thead>
          <tr style={{ background: 'var(--color-bg-alt, #f9fafb)' }}>
            {['Agent', 'Email', 'Assigned'].map((h) => (
              <th
                key={h}
                scope="col"
                style={{
                  padding: '8px 12px',
                  textAlign: 'left',
                  fontWeight: 600,
                  fontSize: 11,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: 'var(--color-muted, #6b7280)',
                  borderBottom: '1px solid var(--color-border, #e5e7eb)',
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {scopes.map((scope) => (
            <tr key={scope.agentId} style={{ borderBottom: '1px solid var(--color-border, #e5e7eb)' }}>
              <td style={{ padding: '10px 12px', fontWeight: 500 }}>{scope.agentName}</td>
              <td style={{ padding: '10px 12px', color: 'var(--color-fg-secondary, #374151)' }}>
                {scope.agentEmail}
              </td>
              <td style={{ padding: '10px 12px', color: 'var(--color-muted, #6b7280)', fontSize: 12 }}>
                {new Date(scope.assignedAt).toLocaleDateString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
