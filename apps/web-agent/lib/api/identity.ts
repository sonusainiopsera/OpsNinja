/**
 * Identity API client stubs — consumed by TanStack Query hooks.
 *
 * These are the shapes expected from WOREF-021's API client.
 * Shell components import these types and hooks; real implementations
 * will be wired when WOREF-021 lands.
 */

import type { AgentRole } from '../navigation/navConfig';

export interface Principal {
  id: string;
  name: string;
  email: string;
  role: AgentRole;
  roles: AgentRole[];
  tenantId: string;
  avatarUrl?: string;
}

export interface OrgScope {
  id: string;
  name: string;
  avatarUrl?: string;
}

export interface OrgScopeResult {
  current: OrgScope | null;
  available: OrgScope[];
}

/** Stub: returns a mock principal. Replace with real fetch when WOREF-021 is ready. */
export async function fetchCurrentPrincipal(): Promise<Principal> {
  return {
    id: 'usr_stub',
    name: 'Agent User',
    email: 'agent@example.com',
    role: 'agent',
    roles: ['agent'],
    tenantId: 'ten_stub',
  };
}

/** Stub: returns mock org scope. Replace with real fetch when WOREF-021 is ready. */
export async function fetchOrgScope(): Promise<OrgScopeResult> {
  return {
    current: { id: 'org_stub', name: 'Stub Organization' },
    available: [{ id: 'org_stub', name: 'Stub Organization' }],
  };
}
