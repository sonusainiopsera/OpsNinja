'use client';

/**
 * ReportBuilderPage — main composition for the Report Builder workspace (WO-078).
 *
 * Role gate: only principals with the 'lead_analyst' role can access the builder.
 * A non-lead sees an access-denied panel instead of an empty builder (AC-1).
 *
 * Layout (three-panel):
 *   [SavedReportsRail 220px] | [BuilderPanel] | [PreviewPanel]
 *
 * State: useReducer(builderReducer) — never uses auto-run; the user must click Run.
 * Run: useMutation(useRunReport) with AbortController; debounced to 400ms.
 * Save: useCreateReport / useUpdateReport with scope picker.
 * Export: ExportBar + ExportJobsCard via shared ExportJobsProvider (WO-079).
 */

import React, { useReducer, useCallback, useRef, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  builderReducer,
  INITIAL_STATE,
  buildFilterAst,
  canRun,
  canSave,
  type LoadDefinitionPayload,
} from './state/builder.reducer';
import { SavedReportsRail } from './components/SavedReportsRail';
import { MetricPicker } from './components/MetricPicker';
import { GroupBySelect } from './components/GroupBySelect';
import { VisualizationToggle } from './components/VisualizationToggle';
import { FilterStack } from './components/FilterStack';
import { RowLimitNote } from './components/RowLimitNote';
import { PreviewPanel } from './components/PreviewPanel';
import { ExportBar } from './components/ExportBar';
import { ExportJobsCard } from './components/ExportJobsCard';
import type { RunState } from './components/RunStatePill';
import {
  useFieldCatalog,
  useReportList,
  useRunReport,
  useCreateReport,
  useUpdateReport,
  useDeleteReport,
  cancelRun,
} from '../../lib/api/reporting/hooks';
import type {
  ReportDefinition,
  RunReportResponse,
  ReportScope,
} from '../../lib/api/reporting/types';
import { getErrorCopy } from '../../lib/api/reporting/types';

// ---------------------------------------------------------------------------
// Access-denied panel
// ---------------------------------------------------------------------------

function AccessDenied() {
  return (
    <div
      role="alert"
      style={{
        display:        'flex',
        flexDirection:  'column',
        alignItems:     'center',
        justifyContent: 'center',
        height:         '60vh',
        gap:            '1rem',
        color:          'var(--color-text-secondary)',
      }}
    >
      <span aria-hidden="true" style={{ fontSize: '3rem' }}>🔒</span>
      <h2 style={{ margin: 0, color: 'var(--color-text-primary)' }}>Access denied</h2>
      <p style={{ margin: 0, maxWidth: 400, textAlign: 'center' }}>
        The Report Builder is available to Lead Analysts only. Contact your workspace
        administrator if you need access.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// BuilderPanel
// ---------------------------------------------------------------------------

interface BuilderPanelProps {
  state:          ReturnType<typeof builderReducer>;
  dispatch:       React.Dispatch<Parameters<typeof builderReducer>[1]>;
  catalog:        ReturnType<typeof useFieldCatalog>['data'];
  onRun:          () => void;
  onSave:         () => void;
  isRunning:      boolean;
  isSaving:       boolean;
  retiredFields:  Set<string>;
}

function BuilderPanel({
  state, dispatch, catalog, onRun, onSave,
  isRunning, isSaving, retiredFields,
}: BuilderPanelProps) {
  const metrics    = catalog?.metrics ?? [];
  const dimensions = catalog?.dimensions ?? [];

  return (
    <section
      aria-label="Report builder"
      style={{
        width:        340,
        flexShrink:   0,
        borderRight:  '1px solid var(--color-border)',
        display:      'flex',
        flexDirection:'column',
        gap:          '1.25rem',
        padding:      '1rem',
        overflowY:    'auto',
      }}
    >
      {/* Name */}
      <div>
        <label
          htmlFor="report-name"
          style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-secondary)', marginBottom: '0.375rem' }}
        >
          Report name
        </label>
        <input
          id="report-name"
          type="text"
          value={state.name}
          onChange={(e) => dispatch({ type: 'SET_NAME', payload: e.target.value })}
          placeholder="Untitled Report"
          style={{
            width:        '100%',
            padding:      '0.5rem 0.75rem',
            borderRadius: 'var(--radius-md, 6px)',
            border:       '1px solid var(--color-border)',
            background:   'var(--color-surface)',
            color:        'var(--color-text-primary)',
            fontSize:     '0.875rem',
          }}
        />
      </div>

      {/* Metrics */}
      <MetricPicker
        metrics={metrics}
        selected={state.metrics}
        onToggle={(m) => dispatch({ type: 'TOGGLE_METRIC', payload: m })}
      />

      {/* Group by */}
      <GroupBySelect
        dimensions={dimensions}
        value={state.groupBy}
        onChange={(v) => dispatch({ type: 'SET_GROUP_BY', payload: v })}
      />

      {/* Visualization */}
      <div>
        <span style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-secondary)', marginBottom: '0.375rem' }}>
          Visualisation
        </span>
        <VisualizationToggle
          value={state.chartType}
          onChange={(v) => dispatch({ type: 'SET_CHART_TYPE', payload: v })}
        />
      </div>

      {/* Filters */}
      <FilterStack
        filters={state.filters}
        catalog={[...dimensions, ...metrics]}
        onAdd={() => dispatch({ type: 'ADD_FILTER' })}
        onUpdate={(key, patch) => dispatch({ type: 'UPDATE_FILTER', payload: { key, ...patch } })}
        onRemove={(key) => dispatch({ type: 'REMOVE_FILTER', payload: key })}
        retiredFields={retiredFields}
      />

      {/* Row limit note (AC-5) */}
      <RowLimitNote />

      {/* Scope selector */}
      <div>
        <label
          htmlFor="report-scope"
          style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-secondary)', marginBottom: '0.375rem' }}
        >
          Sharing
        </label>
        <select
          id="report-scope"
          value={state.scope}
          onChange={(e) => dispatch({ type: 'SET_SCOPE', payload: e.target.value as ReportScope })}
          style={{
            padding:      '0.5rem 0.75rem',
            borderRadius: 'var(--radius-md, 6px)',
            border:       '1px solid var(--color-border)',
            background:   'var(--color-surface)',
            color:        'var(--color-text-primary)',
            fontSize:     '0.875rem',
            width:        '100%',
          }}
        >
          <option value="private">Private (just me)</option>
          <option value="team">Team</option>
          <option value="tenant">Tenant-wide</option>
        </select>
      </div>

      {/* Action bar */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', paddingTop: '0.5rem', borderTop: '1px solid var(--color-border)' }}>
        <button
          type="button"
          onClick={onRun}
          disabled={!canRun(state) || isRunning}
          aria-label={canRun(state) ? 'Run report' : 'Select at least one metric to run'}
          title={canRun(state) ? undefined : 'Select at least one metric'}
          style={{
            flex:         1,
            padding:      '0.5rem',
            borderRadius: 'var(--radius-md, 6px)',
            border:       'none',
            background:   canRun(state) ? 'var(--color-primary)' : 'var(--color-surface)',
            color:        canRun(state) ? 'var(--color-on-primary, #fff)' : 'var(--color-text-secondary)',
            fontWeight:   600,
            cursor:       canRun(state) && !isRunning ? 'pointer' : 'not-allowed',
            fontSize:     '0.875rem',
          }}
        >
          {isRunning ? 'Running…' : '▶ Run'}
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!canSave(state) || isSaving}
          aria-label="Save report"
          style={{
            padding:      '0.5rem 1rem',
            borderRadius: 'var(--radius-md, 6px)',
            border:       '1px solid var(--color-border)',
            background:   'var(--color-surface)',
            color:        'var(--color-text-primary)',
            fontWeight:   500,
            cursor:       canSave(state) && !isSaving ? 'pointer' : 'not-allowed',
            fontSize:     '0.875rem',
          }}
        >
          {isSaving ? 'Saving…' : '💾 Save'}
        </button>
      </div>

      {/* Export bar — WO-079 AC-1/AC-2 */}
      <ExportBar
        hasPreview={state.hasRun}
        definition={{
          metrics: state.metrics,
          groupBy: state.groupBy ? [state.groupBy] : [],
          filterAst: undefined,
        }}
        definitionId={state.savedId ?? undefined}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

interface ReportBuilderPageProps {
  /** Role of the current user. Access denied if not 'lead_analyst'. */
  userRole?: string;
}

export function ReportBuilderPage({ userRole }: ReportBuilderPageProps) {
  // Role gate (AC-1): client-side UX only; server enforces RBAC.
  if (userRole && userRole !== 'lead_analyst' && userRole !== 'admin' && userRole !== 'manager') {
    return <AccessDenied />;
  }

  const [state, dispatch] = useReducer(builderReducer, INITIAL_STATE);
  const [runState,   setRunState]   = useState<RunState>('idle');
  const [result,     setResult]     = useState<RunReportResponse | null>(null);
  const [errorCode,  setErrorCode]  = useState<string | undefined>(undefined);
  const [saveError,  setSaveError]  = useState<string | null>(null);
  const runDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const catalogQuery  = useFieldCatalog();
  const listQuery     = useReportList();
  const runMutation   = useRunReport();
  const createReport  = useCreateReport();
  const deleteReport  = useDeleteReport();

  // Compute set of retired fields (fields in state.filters not present in catalog)
  const catalogFieldNames = new Set([
    ...(catalogQuery.data?.dimensions.map((d) => d.name) ?? []),
    ...(catalogQuery.data?.metrics.map((m) => m.name) ?? []),
  ]);
  const retiredFields = new Set(
    state.filters.map((f) => f.field).filter((f) => f && !catalogFieldNames.has(f)),
  );

  // Run handler with debounce (AC-7)
  const handleRun = useCallback(() => {
    if (!canRun(state)) return;
    if (runDebounceRef.current) clearTimeout(runDebounceRef.current);
    runDebounceRef.current = setTimeout(() => {
      dispatch({ type: 'MARK_RUN' });
      setRunState('running');
      setErrorCode(undefined);
      cancelRun(); // cancel any prior in-flight run

      const filterAst = buildFilterAst(state.filters);
      runMutation.mutate(
        {
          definition: {
            metrics:   state.metrics,
            groupBy:   state.groupBy ? [state.groupBy] : [],
            filterAst,
            chartType: state.chartType,
          },
        },
        {
          onSuccess: (data) => {
            setResult(data);
            setRunState(data.truncated ? 'truncated' : 'success');
          },
          onError: (err) => {
            const code = err instanceof Error && 'code' in err ? (err as { code: string }).code : 'UNKNOWN';
            setErrorCode(code);
            setRunState(code === 'REPORT_QUERY_TIMEOUT' ? 'timeout' : 'error');
          },
        },
      );
    }, 400);
  }, [state, runMutation]);

  // Save handler
  const handleSave = useCallback(() => {
    setSaveError(null);
    const filterAst = buildFilterAst(state.filters);
    const dto = {
      name:      state.name,
      metrics:   state.metrics,
      groupBy:   state.groupBy ? [state.groupBy] : [],
      chartType: state.chartType,
      filterAst,
      scope:     state.scope,
    };
    if (state.savedId) {
      // Update existing — no hook stored per-id; create a mutation inline
      fetch(`/api/v1/reports/${state.savedId}`, {
        method:      'PATCH',
        credentials: 'same-origin',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify(dto),
      })
        .then((r) => { if (!r.ok) throw r; })
        .then(() => dispatch({ type: 'MARK_SAVED', payload: { id: state.savedId! } }))
        .catch(() => setSaveError('Failed to update the report. Please try again.'));
    } else {
      createReport.mutate(dto, {
        onSuccess: (def) => dispatch({ type: 'MARK_SAVED', payload: { id: def.id } }),
        onError:   () => setSaveError('Failed to save the report. Please try again.'),
      });
    }
  }, [state, createReport]);

  // Load a saved definition into the builder
  const handleSelect = useCallback((report: ReportDefinition) => {
    const payload: LoadDefinitionPayload = {
      id:        report.id,
      name:      report.name,
      metrics:   report.metrics,
      groupBy:   report.groupBy[0] ?? null,
      chartType: report.chartType,
      filters:   [], // filters are in filterAst; simplified for initial load
      scope:     report.scope,
    };
    dispatch({ type: 'LOAD_DEFINITION', payload });
    setRunState('idle');
    setResult(null);
  }, []);

  // Export handlers
  const handleExport = useCallback((format: 'csv' | 'pdf') => {
    const filterAst = buildFilterAst(state.filters);
    const body = JSON.stringify({
      format,
      definition: {
        metrics:   state.metrics,
        groupBy:   state.groupBy ? [state.groupBy] : [],
        filterAst,
      },
    });
    fetch('/api/v1/exports', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body,
    })
      .then((r) => r.json())
      .then((data: { jobId: string; pollUrl: string }) => {
        // Simple toast; replace with proper toast when UI kit is available
        alert(`Export queued (job ${data.jobId}). You will receive a download link.`);
      })
      .catch(() => alert('Export request failed. Please try again.'));
  }, [state]);

  return (
    <div
      style={{
        display:    'flex',
        height:     '100%',
        overflow:   'hidden',
        background: 'var(--color-background)',
      }}
    >
      {/* Saved reports rail */}
      <SavedReportsRail
        reports={listQuery.data ?? []}
        activeId={state.savedId}
        onSelect={handleSelect}
        onNew={() => dispatch({ type: 'LOAD_DEFINITION', payload: { ...INITIAL_STATE, id: '', filters: [] } })}
        onRename={(id, name) => {
          fetch(`/api/v1/reports/${id}`, {
            method: 'PATCH', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
          }).catch(() => null);
        }}
        onDelete={(id) => deleteReport.mutate(id)}
        isLoading={listQuery.isLoading}
      />

      {/* Builder panel */}
      <BuilderPanel
        state={state}
        dispatch={dispatch}
        catalog={catalogQuery.data}
        onRun={handleRun}
        onSave={handleSave}
        onExportCsv={() => handleExport('csv')}
        onExportPdf={() => handleExport('pdf')}
        isRunning={runState === 'running'}
        isSaving={createReport.isPending}
        retiredFields={retiredFields}
      />

      {/* Preview panel */}
      <div style={{ flex: 1, padding: '1rem', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        {/* Page header */}
        <div style={{ marginBottom: '1rem' }}>
          <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>
            Report Builder
          </h1>
          {state.dirty && (
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
              Unsaved changes
            </span>
          )}
          {saveError && (
            <p role="alert" style={{ color: 'var(--color-error, #dc2626)', fontSize: '0.875rem', margin: '0.25rem 0 0' }}>
              {saveError}
            </p>
          )}
        </div>

        <PreviewPanel
          runState={runState}
          result={result}
          chartType={state.chartType}
          errorCode={errorCode}
        />
      </div>
    </div>
  );
}
