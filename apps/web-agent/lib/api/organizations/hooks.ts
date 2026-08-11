/**
 * TanStack Query hooks for the Organizations management page — WO-029.
 *
 * Pagination: useInfiniteQuery with cursor-based pages.
 * Filter state: callers pass filters as query-key members; changing any
 * filter resets the infinite query automatically.
 *
 * Mutation side effects:
 *   - list is invalidated on any write
 *   - individual org cache is updated optimistically for low-risk toggles
 *
 * Error handling:
 *   - 409 responses surface currentVersion for reload-and-merge
 *   - 400 details[] mapped to per-field messages by fieldKey
 *   - 5xx: the hook passes the error through; the component shows a toast
 */

'use client';

import {
  useInfiniteQuery,
  useQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryOptions,
  type UseMutationResult,
} from '@tanstack/react-query';
import type {
  Organization,
  OrgContact,
  CustomFieldDef,
  CustomFieldValue,
  AgentScope,
  OrgListFilters,
  ContactListFilters,
  OrganizationsListResponse,
  OrganizationResponse,
  ContactsListResponse,
  ContactResponse,
  CustomFieldDefsResponse,
  OrgMetadataResponse,
  AgentScopesResponse,
  CreateOrgFormValues,
  UpdateOrgFormValues,
  CreateContactFormValues,
  CreateCustomFieldFormValues,
} from './types';

// ---------------------------------------------------------------------------
// Low-level fetch helper
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
    const envelope = body as { error?: { message?: string; code?: string; details?: unknown[] } } | null;
    const err = Object.assign(
      new Error(envelope?.error?.message ?? `HTTP ${res.status}`),
      { status: res.status, body, code: envelope?.error?.code, details: envelope?.error?.details },
    );
    throw err;
  }

  return res.json() as Promise<T>;
}

function buildParams(filters: Record<string, string | number | boolean | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const orgQueryKeys = {
  all: ['organizations'] as const,
  lists: () => [...orgQueryKeys.all, 'list'] as const,
  list: (filters: OrgListFilters) => [...orgQueryKeys.lists(), filters] as const,
  detail: (id: string) => [...orgQueryKeys.all, 'detail', id] as const,
  contacts: (orgId: string, filters?: ContactListFilters) =>
    [...orgQueryKeys.all, 'contacts', orgId, filters ?? {}] as const,
  customFieldDefs: () => [...orgQueryKeys.all, 'customFieldDefs'] as const,
  metadata: (orgId: string) => [...orgQueryKeys.all, 'metadata', orgId] as const,
  agentScopes: (orgId: string) => [...orgQueryKeys.all, 'agentScopes', orgId] as const,
};

// ---------------------------------------------------------------------------
// useOrganizations — infinite cursor pagination
// ---------------------------------------------------------------------------

export function useOrganizations(
  filters: Omit<OrgListFilters, 'cursor'>,
  opts?: Partial<UseInfiniteQueryOptions<OrganizationsListResponse>>,
) {
  return useInfiniteQuery<OrganizationsListResponse>({
    queryKey: orgQueryKeys.list(filters),
    queryFn: async ({ pageParam }) => {
      const cursor = (pageParam as { cursor?: string } | undefined)?.cursor;
      const params = buildParams({ ...filters, ...(cursor ? { cursor } : {}), limit: 25 });
      return apiFetch<OrganizationsListResponse>(`/api/v1/organizations${params}`);
    },
    initialPageParam: undefined,
    getNextPageParam: (page) =>
      page.nextCursor ? { cursor: page.nextCursor } : undefined,
    staleTime: 30_000,
    ...opts,
  });
}

// ---------------------------------------------------------------------------
// useOrganization — single record
// ---------------------------------------------------------------------------

export function useOrganization(id: string | null) {
  return useQuery<Organization>({
    queryKey: orgQueryKeys.detail(id ?? ''),
    queryFn: async () => {
      const { data } = await apiFetch<OrganizationResponse>(`/api/v1/organizations/${id}`);
      return data;
    },
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// useCreateOrganization
// ---------------------------------------------------------------------------

export function useCreateOrganization(): UseMutationResult<Organization, Error, CreateOrgFormValues> {
  const qc = useQueryClient();
  return useMutation<Organization, Error, CreateOrgFormValues>({
    mutationFn: async (payload) => {
      const { data } = await apiFetch<OrganizationResponse>('/api/v1/organizations', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: orgQueryKeys.lists() });
    },
  });
}

// ---------------------------------------------------------------------------
// useUpdateOrganization
// ---------------------------------------------------------------------------

export function useUpdateOrganization(orgId: string): UseMutationResult<Organization, Error, UpdateOrgFormValues> {
  const qc = useQueryClient();
  return useMutation<Organization, Error, UpdateOrgFormValues>({
    mutationFn: async (payload) => {
      const { data } = await apiFetch<OrganizationResponse>(`/api/v1/organizations/${orgId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      return data;
    },
    onSuccess: (data) => {
      qc.setQueryData(orgQueryKeys.detail(orgId), data);
      void qc.invalidateQueries({ queryKey: orgQueryKeys.lists() });
    },
  });
}

// ---------------------------------------------------------------------------
// useDeactivateOrganization
// ---------------------------------------------------------------------------

export function useDeactivateOrganization(orgId: string): UseMutationResult<Organization, Error, void> {
  const qc = useQueryClient();
  return useMutation<Organization, Error, void>({
    mutationFn: async () => {
      const { data } = await apiFetch<OrganizationResponse>(
        `/api/v1/organizations/${orgId}/deactivate`,
        { method: 'POST' },
      );
      return data;
    },
    onSuccess: (data) => {
      qc.setQueryData(orgQueryKeys.detail(orgId), data);
      void qc.invalidateQueries({ queryKey: orgQueryKeys.lists() });
    },
  });
}

// ---------------------------------------------------------------------------
// useReactivateOrganization
// ---------------------------------------------------------------------------

export function useReactivateOrganization(orgId: string): UseMutationResult<Organization, Error, void> {
  const qc = useQueryClient();
  return useMutation<Organization, Error, void>({
    mutationFn: async () => {
      const { data } = await apiFetch<OrganizationResponse>(
        `/api/v1/organizations/${orgId}/reactivate`,
        { method: 'POST' },
      );
      return data;
    },
    onSuccess: (data) => {
      qc.setQueryData(orgQueryKeys.detail(orgId), data);
      void qc.invalidateQueries({ queryKey: orgQueryKeys.lists() });
    },
  });
}

// ---------------------------------------------------------------------------
// useOrgContacts — paginated contacts list
// ---------------------------------------------------------------------------

export function useOrgContacts(orgId: string | null, filters: Omit<ContactListFilters, 'cursor'> = {}) {
  return useInfiniteQuery<ContactsListResponse>({
    queryKey: orgQueryKeys.contacts(orgId ?? '', filters),
    queryFn: async ({ pageParam }) => {
      const cursor = (pageParam as { cursor?: string } | undefined)?.cursor;
      const params = buildParams({ ...filters, ...(cursor ? { cursor } : {}), limit: 25 });
      return apiFetch<ContactsListResponse>(`/api/v1/organizations/${orgId}/contacts${params}`);
    },
    initialPageParam: undefined,
    getNextPageParam: (page) =>
      page.nextCursor ? { cursor: page.nextCursor } : undefined,
    enabled: Boolean(orgId),
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// useTogglePortalAccess — optimistic update with rollback
// ---------------------------------------------------------------------------

export function useTogglePortalAccess(orgId: string) {
  const qc = useQueryClient();

  return useMutation<
    OrgContact,
    Error,
    { contactId: string; enabled: boolean; version: number }
  >({
    mutationFn: async ({ contactId, enabled, version }) => {
      const { data } = await apiFetch<ContactResponse>(
        `/api/v1/organizations/${orgId}/contacts/${contactId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ portalAccessEnabled: enabled, version }),
        },
      );
      return data;
    },
    onMutate: async ({ contactId, enabled }) => {
      // Snapshot before optimistic update
      await qc.cancelQueries({ queryKey: orgQueryKeys.contacts(orgId) });
      const snapshot = qc.getQueriesData<InfiniteData<ContactsListResponse>>({
        queryKey: orgQueryKeys.contacts(orgId),
      });

      // Apply optimistic update
      qc.setQueriesData<InfiniteData<ContactsListResponse>>(
        { queryKey: orgQueryKeys.contacts(orgId) },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              data: page.data.map((c) =>
                c.id === contactId ? { ...c, portalAccessEnabled: enabled } : c,
              ),
            })),
          };
        },
      );

      return { snapshot };
    },
    onError: (_err, _vars, context) => {
      // Roll back optimistic update
      const ctx = context as { snapshot?: Array<[unknown, unknown]> } | undefined;
      ctx?.snapshot?.forEach(([key, value]) => {
        qc.setQueryData(key as Parameters<typeof qc.setQueryData>[0], value);
      });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: orgQueryKeys.contacts(orgId) });
    },
  });
}

// ---------------------------------------------------------------------------
// useCreateContact
// ---------------------------------------------------------------------------

export function useCreateContact(orgId: string): UseMutationResult<OrgContact, Error, CreateContactFormValues> {
  const qc = useQueryClient();
  return useMutation<OrgContact, Error, CreateContactFormValues>({
    mutationFn: async (payload) => {
      const { data } = await apiFetch<ContactResponse>(
        `/api/v1/organizations/${orgId}/contacts`,
        { method: 'POST', body: JSON.stringify(payload) },
      );
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: orgQueryKeys.contacts(orgId) });
    },
  });
}

// ---------------------------------------------------------------------------
// useCustomFieldDefs
// ---------------------------------------------------------------------------

export function useCustomFieldDefs() {
  return useQuery<CustomFieldDef[]>({
    queryKey: orgQueryKeys.customFieldDefs(),
    queryFn: async () => {
      const { data } = await apiFetch<CustomFieldDefsResponse>('/api/v1/custom-field-definitions');
      return data;
    },
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// useCreateCustomFieldDef
// ---------------------------------------------------------------------------

export function useCreateCustomFieldDef(): UseMutationResult<CustomFieldDef, Error, CreateCustomFieldFormValues> {
  const qc = useQueryClient();
  return useMutation<CustomFieldDef, Error, CreateCustomFieldFormValues>({
    mutationFn: async (payload) => {
      const { data } = await apiFetch<{ data: CustomFieldDef }>('/api/v1/custom-field-definitions', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: orgQueryKeys.customFieldDefs() });
    },
  });
}

// ---------------------------------------------------------------------------
// useOrgMetadata
// ---------------------------------------------------------------------------

export function useOrgMetadata(orgId: string | null) {
  return useQuery<CustomFieldValue[]>({
    queryKey: orgQueryKeys.metadata(orgId ?? ''),
    queryFn: async () => {
      const { data } = await apiFetch<OrgMetadataResponse>(
        `/api/v1/organizations/${orgId}/metadata`,
      );
      return data;
    },
    enabled: Boolean(orgId),
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// useSaveOrgMetadata
// ---------------------------------------------------------------------------

export function useSaveOrgMetadata(orgId: string) {
  const qc = useQueryClient();
  return useMutation<CustomFieldValue[], Error, { values: CustomFieldValue[]; version: number }>({
    mutationFn: async ({ values, version }) => {
      const { data } = await apiFetch<OrgMetadataResponse>(
        `/api/v1/organizations/${orgId}/metadata`,
        { method: 'PUT', body: JSON.stringify({ values, version }) },
      );
      return data;
    },
    onSuccess: (data) => {
      qc.setQueryData(orgQueryKeys.metadata(orgId), data);
    },
  });
}

// ---------------------------------------------------------------------------
// useAgentScopes
// ---------------------------------------------------------------------------

export function useAgentScopes(orgId: string | null) {
  return useQuery<AgentScope[]>({
    queryKey: orgQueryKeys.agentScopes(orgId ?? ''),
    queryFn: async () => {
      const { data } = await apiFetch<AgentScopesResponse>(
        `/api/v1/organizations/${orgId}/agent-scopes`,
      );
      return data;
    },
    enabled: Boolean(orgId),
    staleTime: 60_000,
  });
}
