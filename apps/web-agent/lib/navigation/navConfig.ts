/**
 * navConfig — declarative navigation structure with RBAC role requirements.
 *
 * requiredRoles: empty array means any authenticated user can see the item.
 * The canFor() helper filters items before they reach the DOM.
 */

export type AgentRole =
  | 'agent'
  | 'manager'
  | 'admin'
  | 'lead_analyst'
  | 'integration_admin';

export interface NavItem {
  id: string;
  label: string;
  href: string;
  iconName: string;
  requiredRoles: AgentRole[];
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

export const NAV_CONFIG: NavGroup[] = [
  {
    id: 'workspace',
    label: 'Workspace',
    items: [
      {
        id: 'dashboard',
        label: 'Dashboard',
        href: '/dashboard',
        iconName: 'check-circle',
        requiredRoles: [],
      },
      {
        id: 'queues',
        label: 'Ticket Queues',
        href: '/queues',
        iconName: 'clock',
        requiredRoles: [],
      },
    ],
  },
  {
    id: 'management',
    label: 'Management',
    items: [
      {
        id: 'organizations',
        label: 'Organizations',
        href: '/organizations',
        iconName: 'building',
        requiredRoles: ['admin', 'manager'],
      },
      {
        id: 'sla-policies',
        label: 'SLA Policies',
        href: '/sla-policies',
        iconName: 'alert-triangle',
        requiredRoles: ['admin', 'manager'],
      },
      {
        id: 'jira-integration',
        label: 'Jira Integration',
        href: '/jira-integration',
        iconName: 'external-link',
        requiredRoles: ['admin', 'integration_admin'],
      },
    ],
  },
];
