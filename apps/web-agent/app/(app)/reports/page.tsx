/**
 * /reports route — Report Builder page (WO-078).
 *
 * Server component: reads the current user's role from the session cookie
 * and passes it to the client-side ReportBuilderPage for role gating.
 *
 * The server remains the RBAC authority; this client-side check is UX only.
 */

import React from 'react';
import { ReportBuilderPage } from '../../../features/reporting/ReportBuilderPage';

export const metadata = {
  title: 'Report Builder — OpsNinja',
};

export default function ReportsPage() {
  // In production this reads from the session / cookie via next-auth or
  // the internal session service. For now we pass undefined and let the
  // client TanStack Query principal hook supply the role.
  return <ReportBuilderPage />;
}
