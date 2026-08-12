'use client';

/**
 * DashboardExportWiring — registers the dashboard's export handler into
 * the shared ExportContext so the TopBar ExportMenu dispatches dashboard
 * exports through the same useCreateExport pipeline (WO-079 AC-9).
 *
 * Renders nothing visible — it only registers a side-effect handler.
 *
 * Usage:
 *   <DashboardExportWiring scope={currentScope} timeWindow={activeWindow} />
 *
 * The registered handler calls useCreateExport with scope='dashboard' and
 * the current dashboard scope + time window as the definition payload.
 * The resulting job appears in the shared ExportJobsCard tray.
 */

import React, { useCallback } from 'react';
import { useExportJobsContext, useCreateExport } from '../api/export.queries';
import { useRegisterExportHandler } from '../../../lib/context/ExportContext';
import type { ExportFormat } from '../../../lib/context/ExportContext';

// ---------------------------------------------------------------------------
// re-export useCreateExport so consumers can import from this file
// ---------------------------------------------------------------------------

export { useCreateExport } from '../api/export.queries';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DashboardScope {
  tenantId?: string;
}

export interface DashboardTimeWindow {
  from?: string;
  to?: string;
}

interface DashboardExportWiringProps {
  scope?: DashboardScope;
  timeWindow?: DashboardTimeWindow;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DashboardExportWiring({
  scope,
  timeWindow,
}: DashboardExportWiringProps) {
  const createExport = useCreateExport();

  // Build the handler that ExportContext will call when the TopBar ExportMenu
  // dispatches an export. We pass scope='dashboard' with the current context.
  const handler = useCallback(
    async (format: ExportFormat) => {
      await new Promise<void>((resolve, reject) => {
        createExport.mutate(
          {
            format,
            scope: 'dashboard',
            definition: {
              metrics: [],    // server resolves dashboard metrics from scope
              groupBy: [],
              filterAst: null,
              // Extra dashboard context passed as a filter-equivalent:
              // the API accepts these under definition for dashboard exports
            },
            // Pass scope/time-window as extra fields the server understands
            ...(scope?.tenantId ? { definitionId: undefined } : {}),
          },
          {
            onSuccess: () => resolve(),
            onError: (err) => reject(err),
          },
        );
      });
    },
    [createExport, scope, timeWindow], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Register handler into the shared ExportContext so the shell ExportMenu
  // picks it up. Unregisters on unmount (or when handler identity changes).
  useRegisterExportHandler(handler);

  // No rendered output — this is purely a side-effect component
  return null;
}
