import type { Principal, OrgScope } from '@/lib/identity/useIdentity';

export const agentPrincipal: Principal = {
  id: 'user-agent-001',
  name: 'Sam Agent',
  email: 'sam.agent@opsninja.io',
  role: 'agent',
  roles: ['agent'],
  tenantId: 'tenant-001',
};

export const managerPrincipal: Principal = {
  id: 'user-manager-001',
  name: 'Morgan Manager',
  email: 'morgan.manager@opsninja.io',
  role: 'manager',
  roles: ['agent', 'manager'],
  tenantId: 'tenant-001',
};

export const adminPrincipal: Principal = {
  id: 'user-admin-001',
  name: 'Alex Admin',
  email: 'alex.admin@opsninja.io',
  role: 'admin',
  roles: ['agent', 'manager', 'admin'],
  tenantId: 'tenant-001',
};

export const integrationAdminPrincipal: Principal = {
  id: 'user-intadmin-001',
  name: 'Jamie Integration',
  email: 'jamie.integration@opsninja.io',
  role: 'integration_admin',
  roles: ['agent', 'integration_admin'],
  tenantId: 'tenant-001',
};

export const singleOrgScope: OrgScope = {
  currentOrgId: 'org-001',
  organizations: [{ id: 'org-001', name: 'Acme Corp' }],
};

export const multiOrgScope: OrgScope = {
  currentOrgId: 'org-001',
  organizations: [
    { id: 'org-001', name: 'Acme Corp' },
    { id: 'org-002', name: 'Beta Systems' },
    { id: 'org-003', name: 'Gamma Industries' },
  ],
};

export const emptyRolesPrincipal: Principal = {
  id: 'user-empty-001',
  name: 'Empty Roles',
  email: 'empty@opsninja.io',
  role: 'agent',
  roles: [],
  tenantId: 'tenant-001',
};
