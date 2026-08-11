import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { JiraLinkChip } from './JiraLinkChip';
import type { JiraSyncState } from './JiraLinkChip';

const STATES: JiraSyncState[] = ['synced', 'syncing', 'stale', 'failed'];

describe('JiraLinkChip', () => {
  it.each(STATES)('renders %s state with sync label', (syncState) => {
    const { container } = render(
      <JiraLinkChip issueKey="OPS-123" syncState={syncState} />,
    );
    const chip = container.querySelector('[data-jira-chip]');
    expect(chip).not.toBeNull();
  });

  it('shows issue key', () => {
    const { container } = render(
      <JiraLinkChip issueKey="OPS-999" syncState="synced" />,
    );
    expect(container.textContent).toContain('OPS-999');
  });

  it('renders external link for valid https URL', () => {
    const { container } = render(
      <JiraLinkChip issueKey="OPS-1" syncState="synced" issueUrl="https://jira.example.com/browse/OPS-1" />,
    );
    const link = container.querySelector('a');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('https://jira.example.com/browse/OPS-1');
    expect(link?.getAttribute('rel')).toContain('noopener');
    expect(link?.getAttribute('rel')).toContain('noreferrer');
    expect(link?.getAttribute('target')).toBe('_blank');
  });

  it('does not render link for http URL (only https allowed)', () => {
    const { container } = render(
      <JiraLinkChip issueKey="OPS-1" syncState="synced" issueUrl="http://jira.example.com/browse/OPS-1" />,
    );
    expect(container.querySelector('a')).toBeNull();
  });

  it('does not render link when issueUrl is absent', () => {
    const { container } = render(
      <JiraLinkChip issueKey="OPS-1" syncState="synced" />,
    );
    expect(container.querySelector('a')).toBeNull();
  });

  it('does not render link for javascript: URL', () => {
    const { container } = render(
      // eslint-disable-next-line no-script-url
      <JiraLinkChip issueKey="OPS-1" syncState="synced" issueUrl="javascript:alert(1)" />,
    );
    expect(container.querySelector('a')).toBeNull();
  });

  it('has accessible aria-label for sync state', () => {
    const { container } = render(
      <JiraLinkChip issueKey="OPS-1" syncState="failed" />,
    );
    const syncEl = container.querySelector('[aria-label^="Jira sync"]');
    expect(syncEl).not.toBeNull();
    expect(syncEl?.getAttribute('aria-label')).toContain('failed');
  });
});
