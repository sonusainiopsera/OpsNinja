/**
 * navConfig — declarative navigation tree for the agent workspace shell.
 *
 * Each NavItem carries `requiredRoles`: an empty array means any authenticated
 * principal may see the item; a non-empty array requires the principal to hold
 * at least one of the listed roles.
 *
 * RBAC filtering is performed by canFor() and results in entries being
 * EXCLUDED from the rendered DOM — not merely visually hidden.
 */

export type AgentRole =
  | 'agent'
  | 'manager'
  | 'admin'
  | 'integration_admin'
  | 'lead';

export interface NavItem {
  readonly key: string;
  readonly label: string;
  readonly href: string;
  /** Icon identifier consumed by the host icon system. */
  readonly iconName: string;
  /** Empty array = any authenticated role may see this item. */
  readonly requiredRoles: readonly AgentRole[];
}

export interface NavGroup {
  readonly key: string;
  readonly label: string;
  readonly items: readonly NavItem[];
}

export const navConfig: readonly NavGroup[] = [
  {
    key: 'workspace',
    label: 'Workspace',
    items: [
      {
        key: 'dashboard',
        label: 'Dashboard',
        href: '/dashboard',
        iconName: 'layout-dashboard',
        requiredRoles: [],
      },
      {
        key: 'tickets',
        label: 'Ticket Queues',
        href: '/tickets',
        iconName: 'inbox',
        requiredRoles: [],
      },
    ],
  },
  {
    key: 'administration',
    label: 'Administration',
    items: [
      {
        key: 'organizations',
        label: 'Organizations',
        href: '/organizations',
        iconName: 'building-2',
        requiredRoles: ['admin'],
      },
      {
        key: 'sla-policies',
        label: 'SLA Policies',
        href: '/sla-policies',
        iconName: 'clock',
        requiredRoles: ['admin'],
      },
      {
        key: 'jira-integration',
        label: 'Jira Integration',
        href: '/jira-integration',
        iconName: 'plug',
        requiredRoles: ['integration_admin'],
      },
    ],
  },
] as const;
