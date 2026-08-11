import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { JiraLinkChip } from '../domain/JiraLinkChip/JiraLinkChip';

describe('JiraLinkChip', () => {
  const baseProps = {
    issueKey: 'ENG-1234',
    href: 'https://acme.atlassian.net/browse/ENG-1234',
    syncState: 'synced' as const,
  };

  it('renders issue key', () => {
    render(<JiraLinkChip {...baseProps} />);
    expect(screen.getByTestId('jira-link-chip')).toHaveTextContent('ENG-1234');
  });

  it('is an anchor with rel=noopener noreferrer', () => {
    render(<JiraLinkChip {...baseProps} />);
    const a = screen.getByTestId('jira-link-chip');
    expect(a.tagName).toBe('A');
    expect(a).toHaveAttribute('rel', 'noopener noreferrer');
    expect(a).toHaveAttribute('target', '_blank');
  });

  it('uses the provided https href', () => {
    render(<JiraLinkChip {...baseProps} />);
    expect(screen.getByTestId('jira-link-chip')).toHaveAttribute('href', baseProps.href);
  });

  it('falls back to # for non-https hrefs to prevent javascript: injection', () => {
    render(<JiraLinkChip {...baseProps} href="javascript:alert(1)" />);
    expect(screen.getByTestId('jira-link-chip')).toHaveAttribute('href', '#');
  });

  it.each(['synced', 'syncing', 'stale', 'failed'] as const)('renders %s state', (state) => {
    render(<JiraLinkChip {...baseProps} syncState={state} />);
    expect(screen.getByTestId('jira-link-chip')).toHaveAttribute('data-sync-state', state);
  });

  it('aria-label includes issue key and state', () => {
    render(<JiraLinkChip {...baseProps} syncState="failed" />);
    const label = screen.getByTestId('jira-link-chip').getAttribute('aria-label');
    expect(label).toContain('ENG-1234');
    expect(label).toContain('failed');
  });
});
