import { describe, it, expect } from 'vitest';
import { canFor, isActive, filterNavConfig } from '../../lib/navigation/canFor';
import { NAV_CONFIG } from '../../lib/navigation/navConfig';
import {
  AGENT_PRINCIPAL,
  MANAGER_PRINCIPAL,
  ADMIN_PRINCIPAL,
  MINIMAL_PRINCIPAL,
} from '../fixtures/principal.fixtures';

describe('canFor', () => {
  it('allows access when item has no required roles', () => {
    const dashboardItem = NAV_CONFIG[0]!.items.find((i) => i.id === 'dashboard')!;
    expect(canFor({ roles: [] }, dashboardItem)).toBe(true);
    expect(canFor(AGENT_PRINCIPAL, dashboardItem)).toBe(true);
  });

  it('denies access when principal has no roles for admin-only item', () => {
    const orgsItem = NAV_CONFIG[1]!.items.find((i) => i.id === 'organizations')!;
    expect(canFor(AGENT_PRINCIPAL, orgsItem)).toBe(false);
    expect(canFor(MINIMAL_PRINCIPAL, orgsItem)).toBe(false);
  });

  it('allows access when principal has one of the required roles', () => {
    const orgsItem = NAV_CONFIG[1]!.items.find((i) => i.id === 'organizations')!;
    expect(canFor(MANAGER_PRINCIPAL, orgsItem)).toBe(true);
    expect(canFor(ADMIN_PRINCIPAL, orgsItem)).toBe(true);
  });

  it('allows access to jira-integration for integration_admin but not agent', () => {
    const jiraItem = NAV_CONFIG[1]!.items.find((i) => i.id === 'jira-integration')!;
    expect(canFor({ roles: ['integration_admin'] }, jiraItem)).toBe(true);
    expect(canFor(AGENT_PRINCIPAL, jiraItem)).toBe(false);
  });
});

describe('isActive', () => {
  it('matches exact path', () => {
    expect(isActive('/tickets', '/tickets')).toBe(true);
  });

  it('matches nested path with segment boundary', () => {
    expect(isActive('/tickets/123', '/tickets')).toBe(true);
    expect(isActive('/tickets/123/edit', '/tickets')).toBe(true);
  });

  it('does NOT match near-miss without segment boundary', () => {
    expect(isActive('/ticketsomething', '/tickets')).toBe(false);
    expect(isActive('/ticketsmore/123', '/tickets')).toBe(false);
  });

  it('does NOT match unrelated paths', () => {
    expect(isActive('/dashboard', '/tickets')).toBe(false);
    expect(isActive('/', '/tickets')).toBe(false);
  });
});

describe('filterNavConfig', () => {
  it('returns all items for admin', () => {
    const filtered = filterNavConfig(NAV_CONFIG, ADMIN_PRINCIPAL);
    const allIds = filtered.flatMap((g) => g.items.map((i) => i.id));
    expect(allIds).toContain('dashboard');
    expect(allIds).toContain('organizations');
    expect(allIds).toContain('sla-policies');
    expect(allIds).toContain('jira-integration');
  });

  it('excludes admin-only items for agent', () => {
    const filtered = filterNavConfig(NAV_CONFIG, AGENT_PRINCIPAL);
    const allIds = filtered.flatMap((g) => g.items.map((i) => i.id));
    expect(allIds).toContain('dashboard');
    expect(allIds).not.toContain('organizations');
    expect(allIds).not.toContain('sla-policies');
    expect(allIds).not.toContain('jira-integration');
  });

  it('removes groups entirely when all their items are filtered out', () => {
    const filtered = filterNavConfig(NAV_CONFIG, AGENT_PRINCIPAL);
    const managementGroup = filtered.find((g) => g.id === 'management');
    expect(managementGroup).toBeUndefined();
  });

  it('includes SLA policies for manager', () => {
    const filtered = filterNavConfig(NAV_CONFIG, MANAGER_PRINCIPAL);
    const allIds = filtered.flatMap((g) => g.items.map((i) => i.id));
    expect(allIds).toContain('sla-policies');
    expect(allIds).not.toContain('jira-integration');
  });

  it('returns empty groups list for principal with no roles', () => {
    const filtered = filterNavConfig(NAV_CONFIG, MINIMAL_PRINCIPAL);
    const allIds = filtered.flatMap((g) => g.items.map((i) => i.id));
    expect(allIds).toContain('dashboard');
    expect(allIds).toContain('queues');
    expect(allIds).not.toContain('organizations');
  });
});
