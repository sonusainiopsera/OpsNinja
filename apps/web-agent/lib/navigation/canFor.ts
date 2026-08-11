/**
 * canFor — pure RBAC predicate for navigation items.
 *
 * Returns true when the principal holds at least one of the item's
 * requiredRoles, OR when requiredRoles is empty (open to all authenticated).
 * This is a pure function with no side effects so it can be unit tested
 * independently of React.
 */

import type { NavItem, AgentRole } from './navConfig';

export interface PrincipalSnapshot {
  readonly roles: readonly AgentRole[];
}

export function canFor(principal: PrincipalSnapshot, item: NavItem): boolean {
  if (item.requiredRoles.length === 0) return true;
  return item.requiredRoles.some(r => principal.roles.includes(r));
}

/**
 * isActiveRoute — segment-boundary-aware prefix matching.
 *
 * /tickets     → active for /tickets, /tickets/123, /tickets/123/comments
 * /tickets     → NOT active for /ticketsomething (non-segment suffix)
 * /dashboard   → active only for /dashboard and /dashboard/*
 */
export function isActiveRoute(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  // Exact segment-boundary prefix: href must be followed by '/'
  return pathname.startsWith(href + '/');
}

/**
 * filterNavGroups — returns nav groups with items filtered to those the
 * principal may see. Groups with zero visible items are excluded.
 */
export function filterNavGroups<G extends { items: readonly NavItem[] }>(
  groups: readonly G[],
  principal: PrincipalSnapshot,
): G[] {
  return groups
    .map(group => ({
      ...group,
      items: group.items.filter(item => canFor(principal, item)),
    }))
    .filter(group => group.items.length > 0);
}
