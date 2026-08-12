/**
 * Unit tests for JiraLinkCard — WO-053 AC7/AC9.
 *
 * Tests:
 *  1. Not-configured state renders informative text and no action button.
 *  2. Linked state renders issue key as a hyperlink, status chip, and summary.
 *  3. No-link state renders "No Jira issue linked" and the create button.
 *  4. isCreating=true disables the button and shows "Creating…".
 *  5. isCreating=true sets aria-busy on the button.
 *  6. onCreateIssue callback fires on create button click.
 *  7. onCreateIssue is NOT called when isCreating=true (button disabled).
 *  8. Linked state uses aria-label "Jira issue".
 *  9. Not-configured state uses aria-label "Jira integration".
 * 10. Issue key link opens in a new tab (target="_blank").
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { JiraLinkCard } from '../../features/ticket/JiraLinkCard';
import type { JiraLinkDetail } from '../../lib/api/tickets/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const JIRA_LINK_LINKED: JiraLinkDetail = {
  issueKey: 'PLAT-42',
  issueUrl: 'https://acme.atlassian.net/browse/PLAT-42',
  summary: 'Fix login session race condition',
  status: 'In Progress',
  statusCategory: 'in-progress',
};

const JIRA_LINK_DONE: JiraLinkDetail = {
  issueKey: 'OPS-7',
  issueUrl: 'https://acme.atlassian.net/browse/OPS-7',
  summary: 'Closed issue',
  status: 'Done',
  statusCategory: 'done',
};

// ---------------------------------------------------------------------------
// 1. Not-configured state
// ---------------------------------------------------------------------------

describe('JiraLinkCard — not configured', () => {
  it('renders informative text when jiraIntegrationEnabled=false', () => {
    render(
      <JiraLinkCard
        jiraLink={null}
        jiraIntegrationEnabled={false}
      />,
    );
    expect(screen.getByText(/Jira integration not configured/i)).toBeTruthy();
  });

  it('does not render a create button when not configured', () => {
    render(
      <JiraLinkCard
        jiraLink={null}
        jiraIntegrationEnabled={false}
      />,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('AC7 — uses aria-label "Jira integration" when not configured', () => {
    const { container } = render(
      <JiraLinkCard
        jiraLink={null}
        jiraIntegrationEnabled={false}
      />,
    );
    const section = container.querySelector('[aria-label="Jira integration"]');
    expect(section).not.toBeNull();
  });

  it('shows admin contact guidance text', () => {
    render(
      <JiraLinkCard
        jiraLink={null}
        jiraIntegrationEnabled={false}
      />,
    );
    expect(screen.getByText(/Contact your admin/i)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 2. Linked state
// ---------------------------------------------------------------------------

describe('JiraLinkCard — linked state', () => {
  it('renders issue key as a hyperlink', () => {
    render(
      <JiraLinkCard
        jiraLink={JIRA_LINK_LINKED}
        jiraIntegrationEnabled
      />,
    );
    const link = screen.getByRole('link', { name: /PLAT-42/i });
    expect(link).toBeTruthy();
    expect((link as HTMLAnchorElement).href).toContain('PLAT-42');
  });

  it('issue key link points to the Jira issue URL', () => {
    render(
      <JiraLinkCard
        jiraLink={JIRA_LINK_LINKED}
        jiraIntegrationEnabled
      />,
    );
    const link = screen.getByRole('link', { name: /PLAT-42/i }) as HTMLAnchorElement;
    expect(link.href).toBe(JIRA_LINK_LINKED.issueUrl);
  });

  it('AC10 — issue key link opens in a new tab', () => {
    render(
      <JiraLinkCard
        jiraLink={JIRA_LINK_LINKED}
        jiraIntegrationEnabled
      />,
    );
    const link = screen.getByRole('link', { name: /PLAT-42/i }) as HTMLAnchorElement;
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
  });

  it('renders the status chip text', () => {
    render(
      <JiraLinkCard
        jiraLink={JIRA_LINK_LINKED}
        jiraIntegrationEnabled
      />,
    );
    expect(screen.getByText('In Progress')).toBeTruthy();
  });

  it('renders the issue summary text', () => {
    render(
      <JiraLinkCard
        jiraLink={JIRA_LINK_LINKED}
        jiraIntegrationEnabled
      />,
    );
    expect(screen.getByText('Fix login session race condition')).toBeTruthy();
  });

  it('AC7 — uses aria-label "Jira issue" when a link is present', () => {
    const { container } = render(
      <JiraLinkCard
        jiraLink={JIRA_LINK_LINKED}
        jiraIntegrationEnabled
      />,
    );
    const section = container.querySelector('[aria-label="Jira issue"]');
    expect(section).not.toBeNull();
  });

  it('renders "done" status category correctly', () => {
    render(
      <JiraLinkCard
        jiraLink={JIRA_LINK_DONE}
        jiraIntegrationEnabled
      />,
    );
    expect(screen.getByText('Done')).toBeTruthy();
    expect(screen.getByText('OPS-7')).toBeTruthy();
  });

  it('does not render a create button when linked', () => {
    render(
      <JiraLinkCard
        jiraLink={JIRA_LINK_LINKED}
        jiraIntegrationEnabled
      />,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. No-link state — integration enabled but no link yet
// ---------------------------------------------------------------------------

describe('JiraLinkCard — no link yet (enabled)', () => {
  it('renders "No Jira issue linked" when no link and integration enabled', () => {
    render(
      <JiraLinkCard
        jiraLink={null}
        jiraIntegrationEnabled
      />,
    );
    expect(screen.getByText(/No Jira issue linked/i)).toBeTruthy();
  });

  it('renders a create button', () => {
    render(
      <JiraLinkCard
        jiraLink={null}
        jiraIntegrationEnabled
      />,
    );
    const btn = screen.getByRole('button');
    expect(btn).toBeTruthy();
    expect(btn.textContent).toMatch(/\+ Create Jira issue/i);
  });

  it('AC7 — create button is enabled when isCreating=false', () => {
    render(
      <JiraLinkCard
        jiraLink={null}
        jiraIntegrationEnabled
        isCreating={false}
      />,
    );
    const btn = screen.getByRole('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('button does not have aria-busy when not creating', () => {
    render(
      <JiraLinkCard
        jiraLink={null}
        jiraIntegrationEnabled
        isCreating={false}
      />,
    );
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('aria-busy')).not.toBe('true');
  });
});

// ---------------------------------------------------------------------------
// 4 & 5. isCreating=true — button disabled + aria-busy
// ---------------------------------------------------------------------------

describe('JiraLinkCard — isCreating=true', () => {
  it('AC7 — button is disabled while creating', () => {
    render(
      <JiraLinkCard
        jiraLink={null}
        jiraIntegrationEnabled
        isCreating
      />,
    );
    const btn = screen.getByRole('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('AC7 — button shows "Creating…" text while creating', () => {
    render(
      <JiraLinkCard
        jiraLink={null}
        jiraIntegrationEnabled
        isCreating
      />,
    );
    const btn = screen.getByRole('button');
    expect(btn.textContent).toMatch(/Creating/);
  });

  it('AC7 — button has aria-busy=true while creating', () => {
    render(
      <JiraLinkCard
        jiraLink={null}
        jiraIntegrationEnabled
        isCreating
      />,
    );
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('aria-busy')).toBe('true');
  });
});

// ---------------------------------------------------------------------------
// 6. onCreateIssue callback
// ---------------------------------------------------------------------------

describe('JiraLinkCard — onCreateIssue callback', () => {
  it('calls onCreateIssue when create button is clicked', () => {
    const onCreateIssue = vi.fn();
    render(
      <JiraLinkCard
        jiraLink={null}
        jiraIntegrationEnabled
        onCreateIssue={onCreateIssue}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onCreateIssue).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onCreateIssue when button is disabled (isCreating=true)', () => {
    const onCreateIssue = vi.fn();
    render(
      <JiraLinkCard
        jiraLink={null}
        jiraIntegrationEnabled
        onCreateIssue={onCreateIssue}
        isCreating
      />,
    );
    const btn = screen.getByRole('button') as HTMLButtonElement;
    // Directly check button is disabled — clicking a disabled button fires no onClick
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onCreateIssue).not.toHaveBeenCalled();
  });
});
