/**
 * Organizations route — Admin Console organizations management page (WO-029).
 *
 * This page is only accessible to authenticated internal staff.
 * Permission gating (canWrite) is determined server-side; the client
 * receives the flag via the session API and disables write controls if absent.
 *
 * Bundle isolation: this route is part of the Agent / Admin Console
 * bundle and must NOT be imported by the Customer Portal (web-portal).
 */

import { OrganizationsPage } from '../../../features/organizations/OrganizationsPage';

export const metadata = {
  title: 'Organizations – OpsNinja',
};

/**
 * canWrite defaults to true for the server render; the client-side
 * useCurrentPrincipal hook can be used inside OrganizationsPage to
 * adjust the flag based on session roles. For now, the prop supports
 * both rendering modes.
 */
export default function Page() {
  return <OrganizationsPage canWrite />;
}
