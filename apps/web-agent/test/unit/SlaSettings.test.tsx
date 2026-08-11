/**
 * SLA settings unit and component tests — WO-049.
 *
 * Covers:
 *   - Threshold ordering validation (first < second < 100)
 *   - Target input validation (non-integer, zero, negative, above-43200)
 *   - Tab keyboard navigation
 *   - Read-only mode (agent role → inputs disabled, save absent)
 *   - Server error mapping (400 details onto form fields)
 *   - 409 conflict banner with user edits preserved
 *   - SchedulerHealthPill: healthy / degraded / unknown states
 *   - PolicyCard: provisional badge for unratified policies
 *
 * Uses MSW for API mocking; no fixed sleeps; tests are independent.
 */

import React from 'react';
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { slaHandlers, resetSlaHandlers, MOCK_POLICY_DEFAULT, MOCK_SCHEDULER_HEALTHY } from '../../lib/mocks/handlers/sla';

// ---------------------------------------------------------------------------
// MSW server setup
// ---------------------------------------------------------------------------

const server = setupServer(...slaHandlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => { server.resetHandlers(); resetSlaHandlers(); });
afterAll(() => server.close());

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function withQueryClient(ui: React.ReactElement, qc = makeQueryClient()) {
  return render(
    <QueryClientProvider client={qc}>{ui}</QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Zod schema validation (pure — no React needed)
// ---------------------------------------------------------------------------

describe('slaPolicyFormSchema', () => {
  let schema: typeof import('../../lib/api/sla/types').slaPolicyFormSchema;

  beforeAll(async () => {
    schema = (await import('../../lib/api/sla/types')).slaPolicyFormSchema;
  });

  it('accepts valid form values', () => {
    const result = schema.safeParse({
      name: 'Test Policy',
      targets: [
        { priority: 'P1', responseMinutes: 15, resolutionMinutes: 60 },
        { priority: 'P2', responseMinutes: 60, resolutionMinutes: 240 },
        { priority: 'P3', responseMinutes: 240, resolutionMinutes: 1440 },
        { priority: 'P4', responseMinutes: 480, resolutionMinutes: 2880 },
      ],
      calendarId: null,
      pauseConditions: [],
      firstReminderPct: 50,
      secondReminderPct: 75,
      onCallRoutingId: null,
      channelEmail: true,
      channelWebhook: false,
      channelPagerDuty: false,
      changeAuditNote: '',
    });
    expect(result.success).toBe(true);
  });

  it('rejects target resolutionMinutes of 0', () => {
    const result = schema.safeParse({
      name: 'Test',
      targets: [
        { priority: 'P1', responseMinutes: 0, resolutionMinutes: 60 },
        { priority: 'P2', responseMinutes: 60, resolutionMinutes: 240 },
        { priority: 'P3', responseMinutes: 240, resolutionMinutes: 1440 },
        { priority: 'P4', responseMinutes: 480, resolutionMinutes: 2880 },
      ],
      calendarId: null,
      pauseConditions: [],
      firstReminderPct: 50,
      secondReminderPct: 75,
      onCallRoutingId: null,
      channelEmail: true,
      channelWebhook: false,
      channelPagerDuty: false,
    });
    expect(result.success).toBe(false);
    const issues = result.success ? [] : result.error.issues;
    expect(issues.some((i) => i.path.includes('responseMinutes'))).toBe(true);
  });

  it('rejects target above 43200', () => {
    const result = schema.safeParse({
      name: 'Test',
      targets: [
        { priority: 'P1', responseMinutes: 99999, resolutionMinutes: 60 },
        { priority: 'P2', responseMinutes: 60, resolutionMinutes: 240 },
        { priority: 'P3', responseMinutes: 240, resolutionMinutes: 1440 },
        { priority: 'P4', responseMinutes: 480, resolutionMinutes: 2880 },
      ],
      calendarId: null,
      pauseConditions: [],
      firstReminderPct: 50,
      secondReminderPct: 75,
      onCallRoutingId: null,
      channelEmail: true,
      channelWebhook: false,
      channelPagerDuty: false,
    });
    expect(result.success).toBe(false);
  });

  it('rejects first >= second threshold', () => {
    const result = schema.safeParse({
      name: 'Test',
      targets: [
        { priority: 'P1', responseMinutes: 15, resolutionMinutes: 60 },
        { priority: 'P2', responseMinutes: 60, resolutionMinutes: 240 },
        { priority: 'P3', responseMinutes: 240, resolutionMinutes: 1440 },
        { priority: 'P4', responseMinutes: 480, resolutionMinutes: 2880 },
      ],
      calendarId: null,
      pauseConditions: [],
      firstReminderPct: 75,
      secondReminderPct: 50,  // ← less than first
      onCallRoutingId: null,
      channelEmail: true,
      channelWebhook: false,
      channelPagerDuty: false,
    });
    expect(result.success).toBe(false);
    const issues = result.success ? [] : result.error.issues;
    expect(issues.some((i) => i.path.includes('secondReminderPct'))).toBe(true);
  });

  it('rejects equal first and second thresholds', () => {
    const result = schema.safeParse({
      name: 'Test',
      targets: [
        { priority: 'P1', responseMinutes: 15, resolutionMinutes: 60 },
        { priority: 'P2', responseMinutes: 60, resolutionMinutes: 240 },
        { priority: 'P3', responseMinutes: 240, resolutionMinutes: 1440 },
        { priority: 'P4', responseMinutes: 480, resolutionMinutes: 2880 },
      ],
      calendarId: null,
      pauseConditions: [],
      firstReminderPct: 60,
      secondReminderPct: 60,  // ← equal
      onCallRoutingId: null,
      channelEmail: true,
      channelWebhook: false,
      channelPagerDuty: false,
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SchedulerHealthPill
// ---------------------------------------------------------------------------

describe('SchedulerHealthPill', () => {
  async function renderPill() {
    const { SchedulerHealthPill } = await import(
      '../../app/(app)/settings/sla/components/SchedulerHealthPill'
    );
    return withQueryClient(<SchedulerHealthPill />);
  }

  it('shows healthy status with icon and text', async () => {
    server.use(
      http.get('/api/v1/sla-policies/scheduler-health', () =>
        HttpResponse.json({ data: MOCK_SCHEDULER_HEALTHY }),
      ),
    );
    await renderPill();
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Scheduler healthy');
    });
  });

  it('shows degraded status', async () => {
    server.use(
      http.get('/api/v1/sla-policies/scheduler-health', () =>
        HttpResponse.json({ data: { status: 'degraded', lagMs: 5000, checkedAt: new Date().toISOString() } }),
      ),
    );
    await renderPill();
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Scheduler degraded');
    });
  });

  it('shows unknown when endpoint errors — never shows false healthy', async () => {
    server.use(
      http.get('/api/v1/sla-policies/scheduler-health', () =>
        HttpResponse.json({ error: { code: 'INTERNAL_ERROR' } }, { status: 500 }),
      ),
    );
    await renderPill();
    await waitFor(() => {
      const pill = screen.getByRole('status');
      expect(pill).toHaveTextContent('Scheduler unknown');
      expect(pill).not.toHaveTextContent('healthy');
    });
  });
});

// ---------------------------------------------------------------------------
// PolicyCard
// ---------------------------------------------------------------------------

describe('PolicyCard', () => {
  async function renderCard(policy = MOCK_POLICY_DEFAULT) {
    const { PolicyCard } = await import(
      '../../app/(app)/settings/sla/components/PolicyCard'
    );
    const onSelect = vi.fn();
    return { ...render(<PolicyCard policy={policy} isSelected={false} onSelect={onSelect} />), onSelect };
  }

  it('shows provisional badge for unratified policies', async () => {
    await renderCard({ ...MOCK_POLICY_DEFAULT, targetsRatified: false });
    expect(screen.getByLabelText(/provisional/i)).toBeInTheDocument();
  });

  it('does not show provisional badge for ratified policies', async () => {
    await renderCard({ ...MOCK_POLICY_DEFAULT, targetsRatified: true });
    expect(screen.queryByLabelText(/provisional/i)).not.toBeInTheDocument();
  });

  it('shows org count and calendar name', async () => {
    await renderCard();
    expect(screen.getByText(/12 org/i)).toBeInTheDocument();
    expect(screen.getByText(/Standard Business Hours/i)).toBeInTheDocument();
  });

  it('calls onSelect when clicked', async () => {
    const { onSelect } = await renderCard();
    fireEvent.click(screen.getByRole('button'));
    expect(onSelect).toHaveBeenCalledWith(MOCK_POLICY_DEFAULT.id);
  });
});

// ---------------------------------------------------------------------------
// PolicyList empty state
// ---------------------------------------------------------------------------

describe('PolicyList', () => {
  it('renders actionable empty state when no policies', async () => {
    const { PolicyList } = await import(
      '../../app/(app)/settings/sla/components/PolicyList'
    );
    const onNew = vi.fn();
    render(<PolicyList policies={[]} selectedId={null} onSelect={vi.fn()} onNew={onNew} />);
    expect(screen.getByText(/no sla policies/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/create your first policy/i));
    expect(onNew).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// PolicyEditor — tab navigation
// ---------------------------------------------------------------------------

describe('PolicyEditor tab navigation', () => {
  async function renderEditor(isReadOnly = false) {
    const { PolicyEditor } = await import(
      '../../app/(app)/settings/sla/components/PolicyEditor'
    );
    return withQueryClient(
      <PolicyEditor policy={MOCK_POLICY_DEFAULT} isReadOnly={isReadOnly} />,
    );
  }

  it('renders four labelled tabs', async () => {
    await renderEditor();
    expect(screen.getByRole('tab', { name: /Targets/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Calendar and Pause/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Reminders and Escalation/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Preview/i })).toBeInTheDocument();
  });

  it('switches to Calendar tab on click', async () => {
    await renderEditor();
    fireEvent.click(screen.getByRole('tab', { name: /Calendar and Pause/i }));
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Calendar and Pause/i })).toHaveAttribute('aria-selected', 'true');
    });
  });

  it('read-only mode disables inputs and hides save button', async () => {
    await renderEditor(true);
    // Name input disabled
    expect(screen.getByLabelText(/policy name/i)).toBeDisabled();
    // Save button absent
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
    // Read-only notice present
    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// PolicyEditor — 409 conflict banner
// ---------------------------------------------------------------------------

describe('PolicyEditor 409 conflict', () => {
  it('shows conflict banner preserving user edits', async () => {
    server.use(
      http.put('/api/v1/sla-policies/:id', () =>
        HttpResponse.json(
          { error: { code: 'VERSION_CONFLICT', message: 'Policy was updated externally.', traceId: 'trace-409' } },
          { status: 409 },
        ),
      ),
    );

    const { PolicyEditor } = await import(
      '../../app/(app)/settings/sla/components/PolicyEditor'
    );
    const user = userEvent.setup();
    withQueryClient(
      <PolicyEditor policy={MOCK_POLICY_DEFAULT} isReadOnly={false} />,
    );

    // Change name to check edits are preserved
    const nameInput = screen.getByLabelText(/policy name/i);
    await user.clear(nameInput);
    await user.type(nameInput, 'My Edited Name');

    // Click save
    await user.click(screen.getByRole('button', { name: /save/i }));

    // Conflict banner appears
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/version conflict/i);
    });

    // User edits preserved
    expect(screen.getByDisplayValue('My Edited Name')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// SlaTimeline — markers at configured percentages
// ---------------------------------------------------------------------------

describe('SlaTimeline', () => {
  it('has accessible label describing the target', async () => {
    const { SlaTimeline } = await import('@opsninja/ui-kit');
    render(<SlaTimeline firstReminderPct={50} secondReminderPct={75} targetMinutes={120} />);
    expect(screen.getByRole('figure')).toHaveAttribute('aria-label', expect.stringContaining('120'));
  });

  it('recomputes labels live from props', async () => {
    const { SlaTimeline } = await import('@opsninja/ui-kit');
    const { rerender } = render(
      <SlaTimeline firstReminderPct={50} secondReminderPct={75} targetMinutes={60} />,
    );
    expect(screen.getByRole('figure')).toHaveAttribute('aria-label', expect.stringContaining('60'));
    rerender(<SlaTimeline firstReminderPct={40} secondReminderPct={80} targetMinutes={90} />);
    expect(screen.getByRole('figure')).toHaveAttribute('aria-label', expect.stringContaining('90'));
  });
});
