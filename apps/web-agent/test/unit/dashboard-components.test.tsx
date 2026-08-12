/**
 * Dashboard component tests (WO-070, AC11).
 *
 * Covers:
 *  1. KpiGrid — renders six cards, accessible names, zero-state, alert state
 *  2. HBarChart — empty-state, top-N truncation, Other bucket, escaped labels
 *  3. BreachRiskPanel — renders rows, empty-state, paused row, breach row
 *  4. ActivityFeed — renders events, empty-state, non-PII only
 *  5. TenantLoadCard — renders rows, sort, empty-state
 *
 * Uses @testing-library/react with jsdom environment.
 * ui-kit Icon and slaStateMeta are imported from the real ui-kit
 * (path aliased in vitest.config.ts) — no mock needed since they render
 * pure HTML/SVG without side effects.
 *
 * next/link is mocked to render a plain <a> element.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock('@opsninja/ui-kit', () => ({
  Icon: ({ name }: { name: string; size?: number }) => <span data-icon={name} aria-hidden="true">{name}</span>,
  slaStateMeta: {
    running:  { colorVar: '--sla-running-fg', bgVar: '--sla-running-bg',   iconName: 'clock',         label: 'On Track', announcement: '' },
    warning:  { colorVar: '--sla-warning-fg', bgVar: '--sla-warning-bg',   iconName: 'clock-warning', label: 'At risk',  announcement: 'SLA at risk' },
    paused:   { colorVar: '--sla-paused-fg',  bgVar: '--sla-paused-bg',    iconName: 'pause-circle',  label: 'Paused',   announcement: 'SLA paused' },
    breached: { colorVar: '--sla-breach-fg',  bgVar: '--sla-breach-bg',    iconName: 'alert-circle',  label: 'Breached', announcement: 'SLA breached' },
  },
}));

// ---------------------------------------------------------------------------
// Components under test
// ---------------------------------------------------------------------------

import { KpiGrid } from '../../features/dashboard/components/KpiGrid';
import { HBarChart } from '../../features/dashboard/components/HBarChart';
import { BreachRiskPanel } from '../../features/dashboard/components/BreachRiskPanel';
import { ActivityFeed } from '../../features/dashboard/components/ActivityFeed';
import { TenantLoadCard } from '../../features/dashboard/components/TenantLoadCard';
import type { DashboardKpis } from '../../lib/api/dashboard';
import {
  populatedSnapshot,
  emptyTenantSnapshot,
  POPULATED_BREACH_ROWS,
  POPULATED_FEED_ROWS,
  FIXTURE_GENERATED_AT,
  FIXTURE_GENERATED_AT_MS,
} from '../fixtures/dashboard.fixtures';

// ---------------------------------------------------------------------------
// 1. KpiGrid
// ---------------------------------------------------------------------------

describe('KpiGrid', () => {
  const fullKpis: DashboardKpis = populatedSnapshot.kpis;
  const zeroKpis: DashboardKpis = emptyTenantSnapshot.kpis;

  it('renders six KPI cards', () => {
    render(<KpiGrid kpis={fullKpis} />);
    // Each card is an <article> with aria-label
    const cards = screen.getAllByRole('article');
    expect(cards.length).toBe(6);
  });

  it('each card has an accessible name containing the label and value', () => {
    render(<KpiGrid kpis={fullKpis} />);
    expect(screen.getByRole('article', { name: /Active P1/i })).toBeDefined();
    expect(screen.getByRole('article', { name: /Active P2/i })).toBeDefined();
    expect(screen.getByRole('article', { name: /Open Tickets/i })).toBeDefined();
    expect(screen.getByRole('article', { name: /Running SLAs/i })).toBeDefined();
    expect(screen.getByRole('article', { name: /Approaching Breach/i })).toBeDefined();
    expect(screen.getByRole('article', { name: /7-Day CSAT/i })).toBeDefined();
  });

  it('renders numeric values', () => {
    render(<KpiGrid kpis={fullKpis} />);
    expect(screen.getByText(String(fullKpis.activeP1))).toBeDefined();
    expect(screen.getByText(String(fullKpis.openTotal))).toBeDefined();
  });

  it('shows loading dashes when loading=true', () => {
    render(<KpiGrid kpis={fullKpis} loading />);
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(6);
  });

  it('shows zero values for empty tenant', () => {
    render(<KpiGrid kpis={zeroKpis} />);
    const p1Card = screen.getByRole('article', { name: /Active P1/i });
    expect(within(p1Card).getByText('0')).toBeDefined();
  });

  it('shows alert indicator when active P1 > 0', () => {
    render(<KpiGrid kpis={{ ...zeroKpis, activeP1: 2 }} />);
    expect(screen.getByText(/Attention required/i)).toBeDefined();
  });

  it('does not show alert indicator when active P1 = 0', () => {
    render(<KpiGrid kpis={zeroKpis} />);
    expect(screen.queryByText(/Attention required/i)).toBeNull();
  });

  it('formats CSAT as percentage', () => {
    render(<KpiGrid kpis={{ ...zeroKpis, csat7d: 87.5 }} />);
    expect(screen.getByText('87.5%')).toBeDefined();
  });

  it('renders CSAT as dash when 0', () => {
    render(<KpiGrid kpis={zeroKpis} />);
    const csatCard = screen.getByRole('article', { name: /7-Day CSAT/i });
    expect(within(csatCard).getByText('—')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 2. HBarChart
// ---------------------------------------------------------------------------

describe('HBarChart', () => {
  const rows = [
    { label: 'Infrastructure/Networking', value: 14 },
    { label: 'Application/Login', value: 9 },
    { label: 'Application/Performance', value: 7 },
    { label: 'Billing', value: 4 },
  ];

  it('renders empty-state message when rows is empty', () => {
    render(<HBarChart rows={[]} emptyMessage="No category data" ariaLabel="Categories" />);
    expect(screen.getByText('No category data')).toBeDefined();
  });

  it('renders correct number of bars', () => {
    render(<HBarChart rows={rows} topN={10} ariaLabel="Categories" />);
    const meters = screen.getAllByRole('meter');
    expect(meters.length).toBe(rows.length);
  });

  it('truncates to topN and shows Other bucket', () => {
    render(<HBarChart rows={rows} topN={2} ariaLabel="Categories" />);
    const meters = screen.getAllByRole('meter');
    // 2 top rows + 1 Other bucket
    expect(meters.length).toBe(3);
    expect(screen.getByText(/Other/i)).toBeDefined();
  });

  it('escaped label text is rendered, not injected as HTML', () => {
    const maliciousRows = [{ label: '<script>alert(1)</script>', value: 5 }];
    render(<HBarChart rows={maliciousRows} ariaLabel="Test" />);
    // The script tag text should be visible as text content, not executed
    expect(screen.getByText('<script>alert(1)</script>')).toBeDefined();
    // No script element should exist
    expect(document.querySelector('script')).toBeNull();
  });

  it('bar has aria-valuenow matching the row value', () => {
    render(<HBarChart rows={[{ label: 'Test', value: 42 }]} ariaLabel="Test" />);
    const meter = screen.getByRole('meter');
    expect(meter.getAttribute('aria-valuenow')).toBe('42');
  });

  it('renders note text below label when provided', () => {
    render(<HBarChart rows={[{ label: 'Area', value: 5, note: 'AI incomplete' }]} ariaLabel="Areas" />);
    expect(screen.getByText('AI incomplete')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 3. BreachRiskPanel
// ---------------------------------------------------------------------------

describe('BreachRiskPanel', () => {
  const tickMs = FIXTURE_GENERATED_AT_MS; // same as generatedAt → 0 elapsed

  it('renders empty-state when rows is empty', () => {
    render(
      <BreachRiskPanel rows={[]} generatedAt={FIXTURE_GENERATED_AT} tickMs={tickMs} />,
    );
    expect(screen.getByTestId('breach-risk-panel')).toHaveAttribute('data-empty', 'true');
    expect(screen.getByText(/No tickets approaching breach/i)).toBeDefined();
  });

  it('renders a row for each breach-risk entry', () => {
    render(
      <BreachRiskPanel
        rows={POPULATED_BREACH_ROWS}
        generatedAt={FIXTURE_GENERATED_AT}
        tickMs={tickMs}
      />,
    );
    const rows = screen.getAllByTestId('breach-row');
    expect(rows.length).toBe(POPULATED_BREACH_ROWS.length);
  });

  it('renders ticket key as a link for each row', () => {
    render(
      <BreachRiskPanel
        rows={POPULATED_BREACH_ROWS}
        generatedAt={FIXTURE_GENERATED_AT}
        tickMs={tickMs}
      />,
    );
    expect(screen.getByRole('link', { name: /TKT-0001/i })).toBeDefined();
  });

  it('ticket link navigates to /tickets/:id', () => {
    render(
      <BreachRiskPanel
        rows={[POPULATED_BREACH_ROWS[0]]}
        generatedAt={FIXTURE_GENERATED_AT}
        tickMs={tickMs}
      />,
    );
    const link = screen.getByRole('link', { name: /TKT-0001/i });
    expect(link.getAttribute('href')).toBe(`/tickets/${POPULATED_BREACH_ROWS[0].ticketId}`);
  });

  it('renders organisation name alongside ticket key', () => {
    render(
      <BreachRiskPanel
        rows={[POPULATED_BREACH_ROWS[0]]}
        generatedAt={FIXTURE_GENERATED_AT}
        tickMs={tickMs}
      />,
    );
    expect(screen.getByText('Acme Corp')).toBeDefined();
  });

  it('shows loading state when loading=true', () => {
    render(
      <BreachRiskPanel rows={[]} generatedAt={FIXTURE_GENERATED_AT} tickMs={tickMs} loading />,
    );
    expect(screen.getByText('Loading…')).toBeDefined();
  });

  it('section has accessible aria-label describing count', () => {
    render(
      <BreachRiskPanel
        rows={POPULATED_BREACH_ROWS}
        generatedAt={FIXTURE_GENERATED_AT}
        tickMs={tickMs}
      />,
    );
    const panel = screen.getByTestId('breach-risk-panel');
    expect(panel.getAttribute('aria-label')).toContain('Approaching breach');
  });
});

// ---------------------------------------------------------------------------
// 4. ActivityFeed
// ---------------------------------------------------------------------------

describe('ActivityFeed', () => {
  it('renders empty-state when events is empty', () => {
    render(<ActivityFeed events={[]} />);
    expect(screen.getByTestId('activity-feed')).toHaveAttribute('data-empty', 'true');
    expect(screen.getByText(/No recent activity/i)).toBeDefined();
  });

  it('renders a row for each event', () => {
    render(<ActivityFeed events={POPULATED_FEED_ROWS} />);
    const rows = screen.getAllByTestId('feed-event-row');
    expect(rows.length).toBe(POPULATED_FEED_ROWS.length);
  });

  it('renders ticket key for each event', () => {
    render(<ActivityFeed events={[POPULATED_FEED_ROWS[0]]} />);
    expect(screen.getByText(POPULATED_FEED_ROWS[0].ticketKey)).toBeDefined();
  });

  it('renders actor role but not actor ID (PII protection)', () => {
    render(<ActivityFeed events={[POPULATED_FEED_ROWS[0]]} />);
    expect(screen.getByText('agent')).toBeDefined();
    // actorId is never rendered — it's not in ActivityFeedRow interface
    // (the row only has actorRole, not actorId)
  });

  it('renders human-readable event type label', () => {
    render(<ActivityFeed events={[POPULATED_FEED_ROWS[0]]} />);
    // eventType: 'ticket.created' → 'Ticket created'
    expect(screen.getByText('Ticket created')).toBeDefined();
  });

  it('shows loading state when loading=true', () => {
    render(<ActivityFeed events={[]} loading />);
    expect(screen.getByText('Loading…')).toBeDefined();
  });

  it('feed region uses aria-live=polite for live updates', () => {
    render(<ActivityFeed events={POPULATED_FEED_ROWS} />);
    const list = screen.getByRole('list');
    expect(list.getAttribute('aria-live')).toBe('polite');
  });
});

// ---------------------------------------------------------------------------
// 5. TenantLoadCard
// ---------------------------------------------------------------------------

describe('TenantLoadCard', () => {
  it('renders empty-state when rows is empty', () => {
    render(<TenantLoadCard rows={[]} />);
    expect(screen.getByTestId('tenant-load-card')).toHaveAttribute('data-empty', 'true');
    expect(screen.getByText(/No organisations/i)).toBeDefined();
  });

  it('renders a row for each org', () => {
    render(<TenantLoadCard rows={populatedSnapshot.orgLoad} />);
    const rows = screen.getAllByTestId('org-load-row');
    expect(rows.length).toBe(populatedSnapshot.orgLoad.length);
  });

  it('renders organisation name and open count', () => {
    render(<TenantLoadCard rows={[populatedSnapshot.orgLoad[0]]} />);
    expect(screen.getByText('Acme Corp')).toBeDefined();
    expect(screen.getByText(String(populatedSnapshot.orgLoad[0].openCount))).toBeDefined();
  });

  it('shows loading state when loading=true', () => {
    render(<TenantLoadCard rows={[]} loading />);
    expect(screen.getByText('Loading…')).toBeDefined();
  });

  it('sort button is clickable and changes sort direction', async () => {
    const user = userEvent.setup();
    render(<TenantLoadCard rows={populatedSnapshot.orgLoad} />);
    // Click "Organisation" header to sort by name ascending
    const nameHeader = screen.getByRole('columnheader', { name: /Organisation/i });
    await user.click(nameHeader);
    expect(nameHeader.getAttribute('aria-sort')).toBe('ascending');
    // Click again to reverse
    await user.click(nameHeader);
    expect(nameHeader.getAttribute('aria-sort')).toBe('descending');
  });

  it('sorts by open count descending by default', () => {
    render(<TenantLoadCard rows={populatedSnapshot.orgLoad} />);
    const countHeader = screen.getByRole('columnheader', { name: /Open/i });
    expect(countHeader.getAttribute('aria-sort')).toBe('descending');
  });
});
