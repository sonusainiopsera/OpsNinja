/**
 * /settings/sla route — SLA policy and escalation settings admin console.
 *
 * Renders SlaSettingsPage inside the AppShell (applied by the (app) group layout).
 * This is a server component that imports the 'use client' SlaSettingsPage.
 */

import { SlaSettingsPage } from './SlaSettingsPage';

export const metadata = {
  title: 'SLA Policies — OpsNinja',
};

export default function SlaSettingsRoute() {
  return <SlaSettingsPage />;
}
