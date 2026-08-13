/**
 * useOnboarding — WO-088.
 *
 * TanStack Query hook for the portal onboarding wizard.
 *
 * - Server state is the single source of truth for wizard progress.
 * - Per-step PATCH mutations use the version from the last successful
 *   response (optimistic concurrency).
 * - 409 ONBOARDING_STATE_CONFLICT triggers a state refetch so the SPA
 *   reconciles without data loss.
 * - Error shapes match the API contract defined in the work order.
 */

'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Types (mirroring API contract from work order)
// ---------------------------------------------------------------------------

export type StepStatus = 'pending' | 'confirmed' | 'skipped';

export interface StepEntry {
  status:         StepStatus;
  updatedAt:      string;
  contentVersion?: string;
}

export type StepsMap = Partial<Record<'verify-organization' | 'preferences' | 'tutorial', StepEntry>>;

export type CurrentStep = 'verify-organization' | 'preferences' | 'tutorial' | 'complete';

export interface OrganizationField {
  key:   string;
  label: string;
  type:  string;
  value: string;
}

export interface OnboardingState {
  currentStep:  CurrentStep;
  steps:        StepsMap;
  organization: {
    id:              string;
    name:            string;
    tier:            string;
    verifiedDomains: string[];
    metadata?:       OrganizationField[];
  };
  preferenceOptions: {
    channels:       string[];
    digestCadences: string[];
  };
  tutorial: { contentVersion: string };
  completedAt: string | null;
  version: number;
}

export interface ChangeRequestField {
  key:           string;
  currentValue:  string;
  proposedValue: string;
  note?:         string;
}

export type VerifyOrgPayload =
  | { action: 'confirm'; version: number }
  | { action: 'request_change'; fields: ChangeRequestField[]; version: number };

export interface PreferencesPayload {
  channels:      string[];
  digestCadence: string;
  version:       number;
}

export interface TutorialPayload {
  action:         'complete' | 'skip';
  contentVersion: string;
  version:        number;
}

export interface ApiErrorEnvelope {
  error: {
    code:    string;
    message: string;
    details?: unknown[];
    traceId?: string;
  };
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

const BASE = '/api/v1';

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorEnvelope | null;
    const err = Object.assign(
      new Error(body?.error?.message ?? `HTTP ${res.status}`),
      {
        status:  res.status,
        code:    body?.error?.code,
        details: body?.error?.details,
        body,
      },
    );
    throw err;
  }

  const json = (await res.json()) as { data: T };
  return json.data;
}

async function getOnboardingState(): Promise<OnboardingState> {
  return fetchJson<OnboardingState>('/portal/onboarding');
}

async function patchVerifyOrg(payload: VerifyOrgPayload): Promise<OnboardingState> {
  return fetchJson<OnboardingState>('/portal/onboarding/steps/verify-organization', {
    method: 'PATCH',
    body:   JSON.stringify(payload),
  });
}

async function patchPreferences(payload: PreferencesPayload): Promise<OnboardingState> {
  return fetchJson<OnboardingState>('/portal/onboarding/steps/preferences', {
    method: 'PATCH',
    body:   JSON.stringify(payload),
  });
}

async function patchTutorial(payload: TutorialPayload): Promise<OnboardingState> {
  return fetchJson<OnboardingState>('/portal/onboarding/steps/tutorial', {
    method: 'PATCH',
    body:   JSON.stringify(payload),
  });
}

async function postComplete(): Promise<{ completedAt: string }> {
  return fetchJson<{ completedAt: string }>('/portal/onboarding/complete', {
    method: 'POST',
    body:   '{}',
  });
}

// ---------------------------------------------------------------------------
// Query key
// ---------------------------------------------------------------------------

export const ONBOARDING_QUERY_KEY = ['portal', 'onboarding'] as const;

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * useOnboardingState — fetch and cache the current wizard state.
 *
 * Used as the single source of truth for all step components.
 */
export function useOnboardingState() {
  return useQuery<OnboardingState, Error & { status?: number; code?: string }>({
    queryKey: ONBOARDING_QUERY_KEY,
    queryFn:  getOnboardingState,
    staleTime: 0,  // always fetch fresh on mount (state mutates per step)
    retry: (failureCount, error) => {
      if ((error as { status?: number }).status === 401) return false;
      if ((error as { status?: number }).status === 403) return false;
      return failureCount < 2;
    },
  });
}

/**
 * useVerifyOrgMutation — PATCH verify-organization step.
 *
 * On 409 ONBOARDING_STATE_CONFLICT, refetches server state for reconciliation.
 */
export function useVerifyOrgMutation() {
  const qc = useQueryClient();
  return useMutation<OnboardingState, Error & { status?: number; code?: string }, VerifyOrgPayload>({
    mutationFn: patchVerifyOrg,
    onSuccess: (data) => {
      qc.setQueryData(ONBOARDING_QUERY_KEY, data);
    },
    onError: (err) => {
      if ((err as { code?: string }).code === 'ONBOARDING_STATE_CONFLICT') {
        void qc.invalidateQueries({ queryKey: ONBOARDING_QUERY_KEY });
      }
    },
  });
}

/**
 * usePreferencesMutation — PATCH preferences step.
 */
export function usePreferencesMutation() {
  const qc = useQueryClient();
  return useMutation<OnboardingState, Error & { status?: number; code?: string }, PreferencesPayload>({
    mutationFn: patchPreferences,
    onSuccess: (data) => {
      qc.setQueryData(ONBOARDING_QUERY_KEY, data);
    },
    onError: (err) => {
      if ((err as { code?: string }).code === 'ONBOARDING_STATE_CONFLICT') {
        void qc.invalidateQueries({ queryKey: ONBOARDING_QUERY_KEY });
      }
    },
  });
}

/**
 * useTutorialMutation — PATCH tutorial step.
 */
export function useTutorialMutation() {
  const qc = useQueryClient();
  return useMutation<OnboardingState, Error & { status?: number; code?: string }, TutorialPayload>({
    mutationFn: patchTutorial,
    onSuccess: (data) => {
      qc.setQueryData(ONBOARDING_QUERY_KEY, data);
    },
    onError: (err) => {
      if ((err as { code?: string }).code === 'ONBOARDING_STATE_CONFLICT') {
        void qc.invalidateQueries({ queryKey: ONBOARDING_QUERY_KEY });
      }
    },
  });
}

/**
 * useCompleteMutation — POST /complete.
 */
export function useCompleteMutation() {
  const qc = useQueryClient();
  return useMutation<{ completedAt: string }, Error & { status?: number; code?: string }, void>({
    mutationFn: postComplete,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ONBOARDING_QUERY_KEY });
      void qc.invalidateQueries({ queryKey: ['portal', 'identity'] });
    },
  });
}
