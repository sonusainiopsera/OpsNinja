/**
 * Component and unit tests for SLA settings page — WO-049 AC11.
 *
 * Coverage:
 *  - slaPolicyFormSchema: threshold ordering, target minute bounds
 *  - SchedulerHealthPill: healthy/degraded/unknown states, error → unknown
 *  - TargetsPanel: zero/non-integer/above-43200 validation errors, read-only mode
 *  - RemindersPanel: first >= second → error on second field, read-only mode
 *  - PolicyEditor: four tabs with correct labels, keyboard navigation semantics
 *  - PolicyEditor: 409 conflict banner preserves local edits
 *  - PolicyEditor: 400 server errors mapped to form fields
 *  - PolicyEditor: read-only mode hides save action
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import {
  slaPolicyFormSchema,
  DEFAULT_FORM_VALUES,
  type SlaPolicyFormValues,
  type SlaPolicy,
} from '@/lib/api/sla/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/settings/sla'),
  useRouter: vi.fn(() => ({ push: vi.fn(), replace: vi.fn() })),
}));

vi.mock('@/lib/api/sla/hooks', () => ({
  useSchedulerHealth: vi.fn(),
  useSlaPolicies: vi.fn(),
  useSlaPolicy: vi.fn(),
  useSaveSlaPolicy: vi.fn(),
  useSlaCalendars: vi.fn(),
  slaQueryKeys: {
    all: ['sla'],
    policies: () => ['sla', 'policies'],
    policy: (id: string) => ['sla', 'policies', id],
    calendars: () => ['sla', 'calendars'],
    schedulerHealth: () => ['sla', 'scheduler-health'],
  },
}));

// SlaTimeline is an SVG-heavy component not relevant to these unit tests
vi.mock('@opsninja/ui-kit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@opsninja/ui-kit')>();
  return {
    ...actual,
    SlaTimeline: () => <div data-testid="sla-timeline-stub" />,
  };
});

import {
  useSchedulerHealth,
  useSaveSlaPolicy,
  useSlaCalendars,
} from '@/lib/api/sla/hooks';
import { SchedulerHealthPill } from '@/app/(app)/settings/sla/components/SchedulerHealthPill';
import { TargetsPanel } from '@/app/(app)/settings/sla/components/TargetsPanel';
import { RemindersPanel } from '@/app/(app)/settings/sla/components/RemindersPanel';
import { PolicyEditor } from '@/app/(app)/settings/sla/components/PolicyEditor';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function qcWrap(ui: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {ui}
    </QueryClientProvider>,
  );
}

function TargetsPanelWrapper({ disabled }: { disabled?: boolean }) {
  const form = useForm<SlaPolicyFormValues>({
    resolver: zodResolver(slaPolicyFormSchema),
    defaultValues: DEFAULT_FORM_VALUES,
    mode: 'onChange',
  });
  return <TargetsPanel form={form} disabled={disabled} />;
}

function RemindersPanelWrapper({ disabled }: { disabled?: boolean }) {
  const form = useForm<SlaPolicyFormValues>({
    resolver: zodResolver(slaPolicyFormSchema),
    defaultValues: DEFAULT_FORM_VALUES,
    mode: 'onChange',
  });
  return <RemindersPanel form={form} disabled={disabled} />;
}

const MOCK_POLICY: SlaPolicy = {
  id: 'aaaa0001-0000-0000-0000-000000000001',
  name: 'Test Policy',
  scopeType: 'tenant',
  scopeId: null,
  calendarId: null,
  calendarName: null,
  appliedOrganizationCount: 0,
  targetsRatified: true,
  version: 1,
  targets: [
    { priority: 'P1', responseMinutes: 15, resolutionMinutes: 60 },
    { priority: 'P2', responseMinutes: 60, resolutionMinutes: 240 },
    { priority: 'P3', responseMinutes: 240, resolutionMinutes: 1440 },
    { priority: 'P4', responseMinutes: 480, resolutionMinutes: 2880 },
  ],
  pauseConditions: [],
  firstReminderPct: 50,
  secondReminderPct: 75,
  onCallRoutingId: null,
  channelEmail: true,
  channelWebhook: false,
  channelPagerDuty: false,
};

// ---------------------------------------------------------------------------
// slaPolicyFormSchema — pure unit tests (no rendering)
// ---------------------------------------------------------------------------

describe('slaPolicyFormSchema', () => {
  const validBase: SlaPolicyFormValues = { ...DEFAULT_FORM_VALUES, name: 'My Policy' };

  it('accepts valid default values', () => {
    expect(slaPolicyFormSchema.safeParse(validBase).success).toBe(true);
  });

  it('rejects missing policy name', () => {
    expect(slaPolicyFormSchema.safeParse({ ...validBase, name: '' }).success).toBe(false);
  });

  it('rejects zero responseMinutes', () => {
    const result = slaPolicyFormSchema.safeParse({
      ...validBase,
      targets: [
        { priority: 'P1', responseMinutes: 0, resolutionMinutes: 60 },
        ...validBase.targets.slice(1),
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.issues.map((i) => i.path.join('.'));
      expect(fields.some((f) => f.includes('responseMinutes'))).toBe(true);
    }
  });

  it('rejects negative responseMinutes', () => {
    const result = slaPolicyFormSchema.safeParse({
      ...validBase,
      targets: [
        { priority: 'P1', responseMinutes: -5, resolutionMinutes: 60 },
        ...validBase.targets.slice(1),
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects responseMinutes above 43200', () => {
    const result = slaPolicyFormSchema.safeParse({
      ...validBase,
      targets: [
        { priority: 'P1', responseMinutes: 43201, resolutionMinutes: 60 },
        ...validBase.targets.slice(1),
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer responseMinutes', () => {
    const result = slaPolicyFormSchema.safeParse({
      ...validBase,
      targets: [
        { priority: 'P1', responseMinutes: 1.5, resolutionMinutes: 60 },
        ...validBase.targets.slice(1),
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects first >= second reminder (equal values)', () => {
    const result = slaPolicyFormSchema.safeParse({
      ...validBase,
      firstReminderPct: 75,
      secondReminderPct: 75,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.issues.map((i) => i.path.join('.'));
      expect(fields).toContain('secondReminderPct');
    }
  });

  it('rejects first > second reminder', () => {
    const result = slaPolicyFormSchema.safeParse({
      ...validBase,
      firstReminderPct: 80,
      secondReminderPct: 60,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes('secondReminderPct'));
      expect(issue).toBeDefined();
      expect(issue?.message).toContain('must be less than');
    }
  });

  it('superRefine error on secondReminderPct includes both percentages', () => {
    const result = slaPolicyFormSchema.safeParse({
      ...validBase,
      firstReminderPct: 50,
      secondReminderPct: 40,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes('secondReminderPct'));
      expect(issue?.message).toBe(
        'First reminder (50%) must be less than second reminder (40%)',
      );
    }
  });
});

// ---------------------------------------------------------------------------
// SchedulerHealthPill
// ---------------------------------------------------------------------------

describe('SchedulerHealthPill', () => {
  beforeEach(() => {
    vi.mocked(useSchedulerHealth).mockReset();
  });

  it('renders with role=status', () => {
    vi.mocked(useSchedulerHealth).mockReturnValue({
      data: { status: 'healthy', lagMs: null, checkedAt: '' },
      isError: false,
    } as any);
    qcWrap(<SchedulerHealthPill />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows "Scheduler healthy" for healthy status', () => {
    vi.mocked(useSchedulerHealth).mockReturnValue({
      data: { status: 'healthy', lagMs: null, checkedAt: '' },
      isError: false,
    } as any);
    qcWrap(<SchedulerHealthPill />);
    expect(screen.getByRole('status')).toHaveTextContent('Scheduler healthy');
  });

  it('shows "Scheduler degraded" for degraded status', () => {
    vi.mocked(useSchedulerHealth).mockReturnValue({
      data: { status: 'degraded', lagMs: 500, checkedAt: '' },
      isError: false,
    } as any);
    qcWrap(<SchedulerHealthPill />);
    expect(screen.getByRole('status')).toHaveTextContent('Scheduler degraded');
  });

  it('shows "Scheduler unknown" for unknown status', () => {
    vi.mocked(useSchedulerHealth).mockReturnValue({
      data: { status: 'unknown', lagMs: null, checkedAt: '' },
      isError: false,
    } as any);
    qcWrap(<SchedulerHealthPill />);
    expect(screen.getByRole('status')).toHaveTextContent('Scheduler unknown');
  });

  it('shows "Scheduler unknown" when isError=true — never false healthy', () => {
    vi.mocked(useSchedulerHealth).mockReturnValue({
      data: undefined,
      isError: true,
    } as any);
    qcWrap(<SchedulerHealthPill />);
    const pill = screen.getByRole('status');
    expect(pill).toHaveTextContent('Scheduler unknown');
    expect(pill).not.toHaveTextContent('healthy');
  });

  it('shows "Scheduler unknown" when data is undefined (loading/no-data)', () => {
    vi.mocked(useSchedulerHealth).mockReturnValue({
      data: undefined,
      isError: false,
    } as any);
    qcWrap(<SchedulerHealthPill />);
    expect(screen.getByRole('status')).toHaveTextContent('Scheduler unknown');
  });

  it('aria-label describes the scheduler state', () => {
    vi.mocked(useSchedulerHealth).mockReturnValue({
      data: { status: 'healthy', lagMs: null, checkedAt: '' },
      isError: false,
    } as any);
    qcWrap(<SchedulerHealthPill />);
    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      'SLA scheduler is healthy',
    );
  });

  it('renders lag ms when status is healthy and lagMs is present', () => {
    vi.mocked(useSchedulerHealth).mockReturnValue({
      data: { status: 'healthy', lagMs: 123, checkedAt: '' },
      isError: false,
    } as any);
    qcWrap(<SchedulerHealthPill />);
    expect(screen.getByRole('status')).toHaveTextContent('123ms');
  });

  it('does not render lag ms for degraded status', () => {
    vi.mocked(useSchedulerHealth).mockReturnValue({
      data: { status: 'degraded', lagMs: 900, checkedAt: '' },
      isError: false,
    } as any);
    qcWrap(<SchedulerHealthPill />);
    expect(screen.getByRole('status')).not.toHaveTextContent('900ms');
  });
});

// ---------------------------------------------------------------------------
// TargetsPanel — target input validation and read-only mode
// ---------------------------------------------------------------------------

describe('TargetsPanel', () => {
  it('renders 4 priority rows (P1–P4)', () => {
    render(<TargetsPanelWrapper />);
    expect(screen.getAllByRole('row')).toHaveLength(4);
  });

  it('renders 8 number inputs (response + resolution × 4 priorities)', () => {
    render(<TargetsPanelWrapper />);
    expect(screen.getAllByRole('spinbutton')).toHaveLength(8);
  });

  it('shows inline error for zero response minutes', async () => {
    render(<TargetsPanelWrapper />);
    const [p1Response] = screen.getAllByLabelText('Response (minutes)');
    fireEvent.change(p1Response, { target: { value: '0' } });
    await waitFor(() => {
      expect(
        screen.queryByText(/must be at least 1 minute/i) ||
        screen.queryByText(/must be greater than 0/i),
      ).toBeInTheDocument();
    });
  });

  it('shows inline error for response minutes above 43200', async () => {
    render(<TargetsPanelWrapper />);
    const [p1Response] = screen.getAllByLabelText('Response (minutes)');
    fireEvent.change(p1Response, { target: { value: '43201' } });
    await waitFor(() => {
      expect(
        screen.queryByText(/cannot exceed 43,200/i) ||
        screen.queryByText(/43,200 minutes/i),
      ).toBeInTheDocument();
    });
  });

  it('shows inline error for non-integer response minutes', async () => {
    render(<TargetsPanelWrapper />);
    const [p1Response] = screen.getAllByLabelText('Response (minutes)');
    fireEvent.change(p1Response, { target: { value: '1.5' } });
    await waitFor(() => {
      expect(screen.queryByText(/whole number/i)).toBeInTheDocument();
    });
  });

  it('disables all inputs in read-only mode', () => {
    render(<TargetsPanelWrapper disabled={true} />);
    const numberInputs = screen.getAllByRole('spinbutton');
    numberInputs.forEach((input) => {
      expect(input).toBeDisabled();
    });
  });

  it('inputs are not disabled in editable mode', () => {
    render(<TargetsPanelWrapper disabled={false} />);
    const numberInputs = screen.getAllByRole('spinbutton');
    numberInputs.forEach((input) => {
      expect(input).not.toBeDisabled();
    });
  });
});

// ---------------------------------------------------------------------------
// RemindersPanel — threshold ordering and read-only mode
// ---------------------------------------------------------------------------

describe('RemindersPanel', () => {
  it('renders two threshold sliders', () => {
    render(<RemindersPanelWrapper />);
    expect(screen.getAllByRole('slider')).toHaveLength(2);
  });

  it('renders first and second reminder labels', () => {
    render(<RemindersPanelWrapper />);
    expect(screen.getByText('First reminder')).toBeInTheDocument();
    expect(screen.getByText('Second reminder')).toBeInTheDocument();
  });

  it('disables all sliders in read-only mode', () => {
    render(<RemindersPanelWrapper disabled={true} />);
    const sliders = screen.getAllByRole('slider');
    sliders.forEach((s) => expect(s).toBeDisabled());
  });

  it('disables all channel toggles in read-only mode', () => {
    render(<RemindersPanelWrapper disabled={true} />);
    const toggles = screen.getAllByRole('switch');
    toggles.forEach((t) => expect(t).toBeDisabled());
  });

  it('sliders and toggles are enabled in editable mode', () => {
    render(<RemindersPanelWrapper disabled={false} />);
    screen.getAllByRole('slider').forEach((s) => expect(s).not.toBeDisabled());
    screen.getAllByRole('switch').forEach((t) => expect(t).not.toBeDisabled());
  });

  it('shows violation error when second reminder <= first reminder', async () => {
    render(<RemindersPanelWrapper />);
    // Default first=50, second=75. Change second slider to 40 → invalid (40 < 50).
    const [, secondSlider] = screen.getAllByRole('slider');
    fireEvent.change(secondSlider, { target: { value: '40' } });
    await waitFor(() => {
      const alerts = screen.queryAllByRole('alert');
      const violation = alerts.find(
        (a) => a.textContent?.includes('must be greater than') || a.textContent?.includes('must be less than'),
      );
      expect(violation).toBeDefined();
    });
  });

  it('renders on-call routing select', () => {
    render(<RemindersPanelWrapper />);
    expect(screen.getByLabelText('On-Call Routing')).toBeInTheDocument();
  });

  it('renders channel toggles for email, webhook, and PagerDuty', () => {
    render(<RemindersPanelWrapper />);
    expect(screen.getByLabelText(/email notifications/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/webhook notifications/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/pagerduty/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// PolicyEditor — tab navigation, conflict banner, error mapping, read-only
// ---------------------------------------------------------------------------

describe('PolicyEditor', () => {
  beforeEach(() => {
    vi.mocked(useSaveSlaPolicy).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    } as any);
    vi.mocked(useSlaCalendars).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    } as any);
  });

  it('renders exactly four tabs', () => {
    qcWrap(<PolicyEditor policy={MOCK_POLICY} isReadOnly={false} />);
    expect(screen.getAllByRole('tab')).toHaveLength(4);
  });

  it('tab labels are Targets, Calendar and Pause, Reminders and Escalation, Preview', () => {
    qcWrap(<PolicyEditor policy={MOCK_POLICY} isReadOnly={false} />);
    expect(screen.getByRole('tab', { name: 'Targets' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Calendar and Pause' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Reminders and Escalation' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Preview' })).toBeInTheDocument();
  });

  it('tabs list has aria-label for keyboard navigation', () => {
    qcWrap(<PolicyEditor policy={MOCK_POLICY} isReadOnly={false} />);
    expect(screen.getByRole('tablist', { name: 'Policy editor sections' })).toBeInTheDocument();
  });

  it('renders the policy name input pre-populated', () => {
    qcWrap(<PolicyEditor policy={MOCK_POLICY} isReadOnly={false} />);
    expect(screen.getByLabelText('Policy Name')).toHaveValue('Test Policy');
  });

  it('renders save button for editable policy', () => {
    qcWrap(<PolicyEditor policy={MOCK_POLICY} isReadOnly={false} />);
    expect(screen.getByRole('button', { name: /save policy/i })).toBeInTheDocument();
  });

  it('read-only mode: save button is absent', () => {
    qcWrap(<PolicyEditor policy={MOCK_POLICY} isReadOnly={true} />);
    expect(screen.queryByRole('button', { name: /save policy/i })).not.toBeInTheDocument();
  });

  it('read-only mode: policy name input is disabled', () => {
    qcWrap(<PolicyEditor policy={MOCK_POLICY} isReadOnly={true} />);
    expect(screen.getByLabelText('Policy Name')).toBeDisabled();
  });

  it('conflict banner appears and preserves edits on 409 response', async () => {
    const conflictErr = Object.assign(new Error('Conflict'), {
      status: 409,
      body: { error: { message: 'Resource was updated by another session.' } },
    });
    vi.mocked(useSaveSlaPolicy).mockReturnValue({
      mutateAsync: vi.fn().mockRejectedValue(conflictErr),
      isPending: false,
    } as any);

    qcWrap(<PolicyEditor policy={MOCK_POLICY} isReadOnly={false} />);

    const nameInput = screen.getByPlaceholderText('e.g. Default SLA Policy');
    fireEvent.change(nameInput, { target: { value: 'Edited Name' } });
    fireEvent.click(screen.getByRole('button', { name: /save policy/i }));

    await waitFor(() => {
      expect(screen.getByText(/Version conflict:/)).toBeInTheDocument();
      expect(screen.getByText(/Your unsaved changes are preserved\./)).toBeInTheDocument();
    });

    // Local edit is still present after the conflict response
    expect(nameInput).toHaveValue('Edited Name');
  });

  it('400 server error details are mapped to the correct form field', async () => {
    const badRequestErr = Object.assign(new Error('Bad request'), {
      status: 400,
      body: {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: [{ field: 'name', message: 'Name already taken' }],
        },
      },
    });
    vi.mocked(useSaveSlaPolicy).mockReturnValue({
      mutateAsync: vi.fn().mockRejectedValue(badRequestErr),
      isPending: false,
    } as any);

    qcWrap(<PolicyEditor policy={MOCK_POLICY} isReadOnly={false} />);

    const nameInput = screen.getByPlaceholderText('e.g. Default SLA Policy');
    fireEvent.change(nameInput, { target: { value: 'Taken Name' } });
    fireEvent.click(screen.getByRole('button', { name: /save policy/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Name already taken');
    });
  });
});
