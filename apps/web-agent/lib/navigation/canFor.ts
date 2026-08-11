/**
 * canFor — pure RBAC helper for navigation filtering.
 *
 * Returns true when the principal has at least one of the item's required roles,
 * or when the item has no role requirement (public to all authenticated users).
 *
 * isActive — path matcher with segment-boundary awareness.
 * /tickets DOES match /tickets and /tickets/123
 * /tickets DOES NOT match /ticketsomething
 */

import type { AgentRole, NavItem } from './navConfig';

export interface NavPrincipal {
  roles: AgentRole[];
}

export function canFor(principal: NavPrincipal, item: NavItem): boolean {
  if (item.requiredRoles.length === 0) return true;
  return item.requiredRoles.some((r) => principal.roles.includes(r));
}

export function isActive(currentPathname: string, itemHref: string): boolean {
  if (currentPathname === itemHref) return true;
  // Segment-boundary match: /tickets matches /tickets/123 but not /ticketsomething
  return currentPathname.startsWith(itemHref + '/');
}

export function filterNavConfig(
  groups: import('./navConfig').NavGroup[],
  principal: NavPrincipal,
): import('./navConfig').NavGroup[] {
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => canFor(principal, item)),
    }))
    .filter((group) => group.items.length > 0);
}
