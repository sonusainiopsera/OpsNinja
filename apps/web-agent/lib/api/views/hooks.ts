'use client';

/**
 * TanStack Query hooks for saved views — WO-041.
 *
 * Includes optimistic pin/unpin with rollback, and invalidation after create/update.
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import type {
  SavedView,
  ViewListResponse,
  ViewResponse,
  CreateViewPayload,
  UpdateViewPayload,
} from './types';

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    let body: unknown;
    try { body = await res.json(); } catch { body = null; }
    const envelope = body as { error?: { message?: string; code?: string } } | null;
    throw Object.assign(
      new Error(envelope?.error?.message ?? `HTTP ${res.status}`),
      { status: res.status, body, code: envelope?.error?.code },
    );
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const viewQueryKeys = {
  all: ['views'] as const,
  lists: () => [...viewQueryKeys.all, 'list'] as const,
  detail: (id: string) => [...viewQueryKeys.all, 'detail', id] as const,
};

// ---------------------------------------------------------------------------
// useViews — list all views for the rail
// ---------------------------------------------------------------------------

export function useViews() {
  return useQuery<SavedView[]>({
    queryKey: viewQueryKeys.lists(),
    queryFn: async () => {
      const { data } = await apiFetch<ViewListResponse>('/api/v1/views');
      return data;
    },
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// useCreateView — POST /api/v1/views
// ---------------------------------------------------------------------------

export function useCreateView(): UseMutationResult<SavedView, Error, CreateViewPayload> {
  const qc = useQueryClient();
  return useMutation<SavedView, Error, CreateViewPayload>({
    mutationFn: async (payload) => {
      const { data } = await apiFetch<ViewResponse>('/api/v1/views', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: viewQueryKeys.lists() });
    },
  });
}

// ---------------------------------------------------------------------------
// useUpdateView — PATCH /api/v1/views/:id
// ---------------------------------------------------------------------------

export function useUpdateView(viewId: string): UseMutationResult<SavedView, Error, UpdateViewPayload> {
  const qc = useQueryClient();
  return useMutation<SavedView, Error, UpdateViewPayload>({
    mutationFn: async (payload) => {
      const { data } = await apiFetch<ViewResponse>(`/api/v1/views/${viewId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      return data;
    },
    onSuccess: (updated) => {
      // Update individual cache entry and invalidate list
      qc.setQueryData(viewQueryKeys.detail(viewId), updated);
      void qc.invalidateQueries({ queryKey: viewQueryKeys.lists() });
    },
  });
}

// ---------------------------------------------------------------------------
// usePinView — optimistic pin/unpin with rollback
// ---------------------------------------------------------------------------

export function usePinView() {
  const qc = useQueryClient();
  return useMutation<
    SavedView,
    Error,
    { viewId: string; pinned: boolean; version: number }
  >({
    mutationFn: async ({ viewId, pinned, version }) => {
      const { data } = await apiFetch<ViewResponse>(`/api/v1/views/${viewId}`, {
        method: 'PATCH',
        body: JSON.stringify({ pinned, version }),
      });
      return data;
    },
    onMutate: async ({ viewId, pinned }) => {
      await qc.cancelQueries({ queryKey: viewQueryKeys.lists() });
      const snapshot = qc.getQueryData<SavedView[]>(viewQueryKeys.lists());
      qc.setQueryData<SavedView[]>(viewQueryKeys.lists(), (old) =>
        old?.map((v) => (v.id === viewId ? { ...v, pinned } : v)),
      );
      return { snapshot };
    },
    onError: (_err, _vars, ctx) => {
      const context = ctx as { snapshot?: SavedView[] } | undefined;
      if (context?.snapshot) {
        qc.setQueryData(viewQueryKeys.lists(), context.snapshot);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: viewQueryKeys.lists() });
    },
  });
}

// ---------------------------------------------------------------------------
// useDeleteView — DELETE /api/v1/views/:id
// ---------------------------------------------------------------------------

export function useDeleteView(): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (viewId) => {
      await apiFetch<void>(`/api/v1/views/${viewId}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: viewQueryKeys.lists() });
    },
  });
}
