/**
 * /jira-integration route — Jira Integration Console (WO-058).
 *
 * Accessible to authenticated principals with the integration_admin or admin
 * role (enforced in navConfig.requiredRoles and server-side by jira:manage
 * and jira:read permission guards on API endpoints).
 *
 * canWrite is provisioned here at the server component level; for the
 * scaffold pass true — real permission derivation is handled by the session
 * API and can be wired to useCurrentPrincipal inside the page component.
 */

import { JiraIntegrationPage } from '../../../features/jira-integration/JiraIntegrationPage';

export const metadata = {
  title: 'Jira Integration — OpsNinja',
};

export default function JiraIntegrationRoute() {
  return <JiraIntegrationPage canWrite />;
}
