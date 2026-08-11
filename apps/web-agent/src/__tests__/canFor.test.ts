import { describe, expect, it } from 'vitest';
import { canFor, isActiveRoute, filterNavGroups } from '@/lib/navigation/canFor';
import { navConfig } from '@/lib/navigation/navConfig';
import {
  agentPrincipal,
  adminPrincipal,
  integrationAdminPrincipal,
  emptyRolesPrincipal,
  managerPrincipal,
} from '../fixtures/identity.fixtures';

describe('canFor', () => {
  const openItem = { key: 'dashboard', label: 'Dashboard', href: '/dashboard', iconName: 'x', requiredRoles: [] } as const;
  const adminItem = { key: 'orgs', label: 'Orgs', href: '/orgs', iconName: 'x', requiredRoles: ['admin'] } as const;
  const intAdminItem = { key: 'jira', label: 'Jira', href: '/jira', iconName: 'x', requiredRoles: ['integration_admin'] } as const;

  it('allows open items for any role', () => {
    expect(canFor(agentPrincipal, openItem)).toBe(true);
    expect(canFor(adminPrincipal, openItem)).toBe(true);
    expect(canFor(emptyRolesPrincipal, openItem)).toBe(true);
  });

  it('denies admin item for agent', () => {
    expect(canFor(agentPrincipal, adminItem)).toBe(false);
  });

  it('allows admin item for admin', () => {
    expect(canFor(adminPrincipal, adminItem)).toBe(true);
  });

  it('allows admin item for manager with admin role', () => {
    expect(canFor({ roles: ['manager', 'admin'] }, adminItem)).toBe(true);
  });

  it('denies integration_admin item for agent', () => {
    expect(canFor(agentPrincipal, intAdminItem)).toBe(false);
  });

  it('allows integration_admin item for integration_admin', () => {
    expect(canFor(integrationAdminPrincipal, intAdminItem)).toBe(true);
  });

  it('denies all role-gated items for empty roles principal', () => {
    expect(canFor(emptyRolesPrincipal, adminItem)).toBe(false);
    expect(canFor(emptyRolesPrincipal, intAdminItem)).toBe(false);
  });
});

describe('isActiveRoute', () => {
  it('matches exact path', () => {
    expect(isActiveRoute('/tickets', '/tickets')).toBe(true);
  });

  it('matches nested path with segment boundary', () => {
    expect(isActiveRoute('/tickets/123', '/tickets')).toBe(true);
    expect(isActiveRoute('/tickets/123/comments', '/tickets')).toBe(true);
  });

  it('does NOT match non-segment prefix (/ticketsomething)', () => {
    expect(isActiveRoute('/ticketsomething', '/tickets')).toBe(false);
  });

  it('does not match unrelated path', () => {
    expect(isActiveRoute('/dashboard', '/tickets')).toBe(false);
  });

  it('matches dashboard exactly', () => {
    expect(isActiveRoute('/dashboard', '/dashboard')).toBe(true);
  });

  it('matches dashboard sub-routes', () => {
    expect(isActiveRoute('/dashboard/reports', '/dashboard')).toBe(true);
  });
});

describe('filterNavGroups', () => {
  it('agent sees workspace group but not administration items', () => {
    const filtered = filterNavGroups(navConfig as typeof navConfig, agentPrincipal);
    const allItems = filtered.flatMap(g => g.items);
    const keys = allItems.map(i => i.key);
    expect(keys).toContain('dashboard');
    expect(keys).toContain('tickets');
    expect(keys).not.toContain('organizations');
    expect(keys).not.toContain('sla-policies');
    expect(keys).not.toContain('jira-integration');
  });

  it('admin sees workspace + administration groups', () => {
    const filtered = filterNavGroups(navConfig as typeof navConfig, adminPrincipal);
    const keys = filtered.flatMap(g => g.items).map(i => i.key);
    expect(keys).toContain('organizations');
    expect(keys).toContain('sla-policies');
  });

  it('integration_admin sees jira-integration but not organizations', () => {
    const filtered = filterNavGroups(navConfig as typeof navConfig, integrationAdminPrincipal);
    const keys = filtered.flatMap(g => g.items).map(i => i.key);
    expect(keys).toContain('jira-integration');
    expect(keys).not.toContain('organizations');
  });

  it('excludes empty groups from result', () => {
    const filtered = filterNavGroups(navConfig as typeof navConfig, emptyRolesPrincipal);
    const adminGroup = filtered.find(g => g.key === 'administration');
    expect(adminGroup).toBeUndefined();
  });

  it('manager with agent+manager roles sees workspace items', () => {
    const filtered = filterNavGroups(navConfig as typeof navConfig, managerPrincipal);
    const keys = filtered.flatMap(g => g.items).map(i => i.key);
    expect(keys).toContain('dashboard');
    expect(keys).toContain('tickets');
  });
});
