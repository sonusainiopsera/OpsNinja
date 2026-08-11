'use client';

/**
 * JiraLinkCard — WO-042.
 *
 * Shows the linked Jira issue (key, status, summary) or a create-issue CTA.
 * Degrades gracefully when the tenant has no Jira integration configured:
 * renders an informative disabled state rather than an error toast.
 */

import React from 'react';
import type { JiraLinkDetail } from '../../lib/api/tickets/types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface JiraLinkCardProps {
  jiraLink: JiraLinkDetail | null;
  jiraIntegrationEnabled: boolean;
  onCreateIssue?: () => void;
  isCreating?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function JiraLinkCard({
  jiraLink,
  jiraIntegrationEnabled,
  onCreateIssue,
  isCreating = false,
}: JiraLinkCardProps) {
  if (!jiraIntegrationEnabled) {
    return (
      <section
        aria-label="Jira integration"
        style={{
          padding: 12,
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          background: '#f9fafb',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span aria-hidden="true" style={{ fontSize: 16, opacity: 0.4 }}>🔗</span>
          <div>
            <p style={{ fontSize: 13, fontWeight: 600, color: '#9ca3af', margin: '0 0 2px' }}>
              Jira integration not configured
            </p>
            <p style={{ fontSize: 12, color: '#d1d5db', margin: 0 }}>
              Contact your admin to connect Jira to this workspace.
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (jiraLink) {
    const badgeColor: Record<string, string> = {
      'todo': '#6b7280',
      'in-progress': '#2563eb',
      'done': '#16a34a',
    };

    return (
      <section
        aria-label="Jira issue"
        style={{
          padding: 12,
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          background: '#ffffff',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <span aria-hidden="true" style={{ fontSize: 16, marginTop: 1 }}>🔗</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <a
                href={jiraLink.issueUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontWeight: 700,
                  fontSize: 13,
                  color: '#2563eb',
                  textDecoration: 'none',
                }}
                aria-label={`Jira issue ${jiraLink.issueKey}`}
              >
                {jiraLink.issueKey}
              </a>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '1px 6px',
                  borderRadius: 10,
                  background: `${badgeColor[jiraLink.statusCategory] ?? '#6b7280'}18`,
                  color: badgeColor[jiraLink.statusCategory] ?? '#6b7280',
                }}
              >
                {jiraLink.status}
              </span>
            </div>
            <p style={{ fontSize: 12, color: '#6b7280', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {jiraLink.summary}
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Jira integration"
      style={{
        padding: 12,
        border: '1px dashed #d1d5db',
        borderRadius: 8,
        background: '#ffffff',
        textAlign: 'center',
      }}
    >
      <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 8px' }}>
        No Jira issue linked
      </p>
      <button
        type="button"
        onClick={onCreateIssue}
        disabled={isCreating}
        style={{
          fontSize: 12,
          fontWeight: 600,
          padding: '5px 14px',
          borderRadius: 6,
          border: '1px solid #d1d5db',
          background: isCreating ? '#f3f4f6' : '#ffffff',
          color: isCreating ? '#9ca3af' : '#374151',
          cursor: isCreating ? 'not-allowed' : 'pointer',
        }}
        aria-busy={isCreating}
      >
        {isCreating ? 'Creating…' : '+ Create Jira issue'}
      </button>
    </section>
  );
}
