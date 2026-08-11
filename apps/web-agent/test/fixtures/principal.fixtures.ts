import type { Principal } from '../../lib/api/identity';

export const AGENT_PRINCIPAL: Principal = {
  id: 'usr_agent',
  name: 'Alice Agent',
  email: 'alice@opsninja.io',
  role: 'agent',
  roles: ['agent'],
  tenantId: 'ten_001',
};

export const MANAGER_PRINCIPAL: Principal = {
  id: 'usr_manager',
  name: 'Bob Manager',
  email: 'bob@opsninja.io',
  role: 'manager',
  roles: ['agent', 'manager'],
  tenantId: 'ten_001',
};

export const ADMIN_PRINCIPAL: Principal = {
  id: 'usr_admin',
  name: 'Carol Admin',
  email: 'carol@opsninja.io',
  role: 'admin',
  roles: ['agent', 'manager', 'admin'],
  tenantId: 'ten_001',
};

export const INTEGRATION_ADMIN_PRINCIPAL: Principal = {
  id: 'usr_intadmin',
  name: 'Dave IntAdmin',
  email: 'dave@opsninja.io',
  role: 'integration_admin',
  roles: ['integration_admin'],
  tenantId: 'ten_001',
};

export const MINIMAL_PRINCIPAL: Principal = {
  id: 'usr_min',
  name: 'Erin Minimal',
  email: 'erin@opsninja.io',
  role: 'agent',
  roles: [],
  tenantId: 'ten_001',
};
