/**
 * Browser MSW worker — enables offline/local demo data for the agent UI.
 */
import { setupWorker } from 'msw/browser';
import { queueHandlers } from './handlers/queue';
import { ticketDetailHandlers } from './handlers/ticket-detail';
import { slaHandlers } from './handlers/sla';
import { reportingHandlers } from './handlers/reporting.handlers';
import { organizationHandlers } from './handlers/organizations';
import { jiraHandlers } from './handlers/jira-integration';
import { portalSignupHandlers } from './handlers/portal-signups.handlers';

export const worker = setupWorker(
  ...queueHandlers,
  ...ticketDetailHandlers,
  ...slaHandlers,
  ...reportingHandlers,
  ...organizationHandlers,
  ...jiraHandlers,
  ...portalSignupHandlers,
);
