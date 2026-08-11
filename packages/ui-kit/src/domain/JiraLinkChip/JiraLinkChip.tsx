/**
 * JiraLinkChip — Jira issue key with sync state indicator.
 *
 * Sync states: synced | syncing | stale | failed
 * External links only rendered from server-provided absolute https URLs;
 * no URL construction from unvalidated tenant input.
 */

import React from 'react';
import { Icon } from '../../Icon';

export type JiraSyncState = 'synced' | 'syncing' | 'stale' | 'failed';

interface SyncStateMeta {
  iconName: 'check-circle' | 'loader' | 'refresh-cw' | 'x-circle';
  label: string;
  colorVar: string;
}

const SYNC_STATE_META: Record<JiraSyncState, SyncStateMeta> = {
  synced: { iconName: 'check-circle', label: 'Synced', colorVar: '--jira-synced-fg' },
  syncing: { iconName: 'loader', label: 'Syncing', colorVar: '--jira-syncing-fg' },
  stale: { iconName: 'refresh-cw', label: 'Pending sync', colorVar: '--jira-stale-fg' },
  failed: { iconName: 'x-circle', label: 'Sync failed', colorVar: '--jira-failed-fg' },
};

export const JIRA_CSS_VARS = `
  --jira-synced-fg: #0e7a3c;
  --jira-syncing-fg: #1e3a5f;
  --jira-stale-fg: #78350f;
  --jira-failed-fg: #991b1b;
`;

export interface JiraLinkChipProps {
  /** Jira issue key (e.g. "OPS-1234"). Empty string renders without key. */
  issueKey: string;
  /** Sync state from the Jira worker. */
  syncState: JiraSyncState;
  /**
   * Absolute https URL from the server. Never constructed from tenant input.
   * When absent or invalid, no link element is rendered.
   */
  issueUrl?: string;
  className?: string;
}

function isSafeUrl(url: string | undefined): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function JiraLinkChip({ issueKey, syncState, issueUrl, className }: JiraLinkChipProps) {
  const meta = SYNC_STATE_META[syncState];
  const safeUrl = isSafeUrl(issueUrl) ? issueUrl : undefined;

  const chipStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '2px 8px',
    borderRadius: 3,
    background: 'var(--jira-chip-bg, #f0f4ff)',
    fontSize: 12,
    fontFamily: 'monospace',
    userSelect: 'none',
  };

  const syncStyle: React.CSSProperties = {
    color: `var(${meta.colorVar})`,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 2,
  };

  const keyPart = issueKey ? (
    <span aria-hidden="true">{issueKey}</span>
  ) : null;

  const content = (
    <span style={chipStyle} className={className} data-jira-chip>
      {keyPart}
      <span style={syncStyle} aria-label={`Jira sync: ${meta.label}`}>
        <Icon name={meta.iconName} size={12} />
        <span style={{ fontSize: 11 }}>{meta.label}</span>
      </span>
      {safeUrl && (
        <a
          href={safeUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${issueKey || 'Jira issue'} in new tab`}
          onClick={(e) => e.stopPropagation()}
          style={{ color: 'inherit', marginLeft: 2 }}
        >
          <Icon name="external-link" size={11} />
        </a>
      )}
    </span>
  );

  return content;
}
