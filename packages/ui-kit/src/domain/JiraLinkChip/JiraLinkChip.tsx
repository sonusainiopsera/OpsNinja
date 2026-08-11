import React from 'react';

export type JiraSyncState = 'synced' | 'syncing' | 'stale' | 'failed';

export interface JiraLinkChipProps {
  issueKey: string;
  /** Absolute URL to the Jira issue. Must be https://. */
  href: string;
  syncState: JiraSyncState;
  className?: string;
}

const syncStateConfig: Record<JiraSyncState, { label: string; icon: string; ariaLabel: string }> = {
  synced:  { label: 'Synced',   icon: '✓',  ariaLabel: 'Jira issue synced'  },
  syncing: { label: 'Syncing',  icon: '↻',  ariaLabel: 'Jira issue syncing' },
  stale:   { label: 'Stale',    icon: '⚠',  ariaLabel: 'Jira issue stale'   },
  failed:  { label: 'Failed',   icon: '✕',  ariaLabel: 'Jira issue sync failed' },
};

const stateStyles: Record<JiraSyncState, React.CSSProperties> = {
  synced:  { color: 'var(--color-jira-synced-text,  #065f46)', background: 'var(--color-jira-synced-bg,  #d1fae5)' },
  syncing: { color: 'var(--color-jira-syncing-text, #1e40af)', background: 'var(--color-jira-syncing-bg, #dbeafe)' },
  stale:   { color: 'var(--color-jira-stale-text,   #92400e)', background: 'var(--color-jira-stale-bg,   #fef3c7)' },
  failed:  { color: 'var(--color-jira-failed-text,  #991b1b)', background: 'var(--color-jira-failed-bg,  #fee2e2)' },
};

export function JiraLinkChip({ issueKey, href, syncState, className }: JiraLinkChipProps) {
  const config = syncStateConfig[syncState];

  // Guard against non-https hrefs to prevent javascript: injection
  const safeHref = href.startsWith('https://') ? href : '#';

  return (
    <a
      href={safeHref}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${issueKey} — ${config.ariaLabel}, opens in new tab`}
      data-testid="jira-link-chip"
      data-sync-state={syncState}
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.25rem',
        padding: '0.125rem 0.5rem',
        borderRadius: '9999px',
        fontSize: '0.75rem',
        fontWeight: 600,
        textDecoration: 'none',
        whiteSpace: 'nowrap',
        ...stateStyles[syncState],
      }}
    >
      <span aria-hidden="true">{config.icon}</span>
      <span>{issueKey}</span>
      <span aria-hidden="true" style={{ fontSize: '0.6rem', opacity: 0.7 }}>↗</span>
    </a>
  );
}
