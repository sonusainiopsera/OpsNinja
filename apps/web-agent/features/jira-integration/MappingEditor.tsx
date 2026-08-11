'use client';

/**
 * MappingEditor — lists Jira projects and issue types from discovery endpoints,
 * supports field/status mapping rows with per-path validation errors, sync-rule
 * toggles, and Save with 409 optimistic-concurrency conflict handling (WO-058).
 *
 * 409 conflict → reload-and-merge prompt (never silently overwrites).
 */

import React, { useState, useEffect } from 'react';
import type { JiraProjectMapping, FieldMapEntry, StatusMapEntry, SyncRules } from '../../lib/api/jira/types';
import { useJiraProjects, useJiraFields, useSaveMapping, type ApiError } from '../../lib/api/jira/hooks';

interface ValidationError {
  path: string;
  message: string;
}

interface Props {
  connectionId: string;
  mapping: JiraProjectMapping | null;
  canWrite: boolean;
  onSaved: (saved: JiraProjectMapping) => void;
}

export function MappingEditor({ connectionId, mapping, canWrite, onSaved }: Props) {
  const [projectKey, setProjectKey] = useState(mapping?.projectKey ?? '');
  const [projectId, setProjectId] = useState(mapping?.projectId ?? '');
  const [issueTypeId, setIssueTypeId] = useState(mapping?.defaultIssueTypeId ?? '');
  const [fieldMap, setFieldMap] = useState<FieldMapEntry[]>(mapping?.fieldMap ?? []);
  const [statusMap, setStatusMap] = useState<StatusMapEntry[]>(mapping?.statusMap ?? []);
  const [syncRules, setSyncRules] = useState<SyncRules>(
    mapping?.syncRules ?? { syncComments: true, syncStatusChanges: true, commentVisibility: 'public' },
  );
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [conflict, setConflict] = useState(false);

  const projectsQuery = useJiraProjects(connectionId);
  const fieldsQuery = useJiraFields(connectionId, projectKey || null, issueTypeId || null);
  const saveMutation = useSaveMapping();

  // Reset form when mapping changes
  useEffect(() => {
    if (mapping) {
      setProjectKey(mapping.projectKey);
      setProjectId(mapping.projectId);
      setIssueTypeId(mapping.defaultIssueTypeId);
      setFieldMap(mapping.fieldMap);
      setStatusMap(mapping.statusMap);
      setSyncRules(mapping.syncRules);
      setValidationErrors([]);
      setConflict(false);
    }
  }, [mapping?.id]);

  function getFieldError(path: string): string | undefined {
    return validationErrors.find((e) => e.path === path)?.message;
  }

  async function handleSave() {
    setValidationErrors([]);
    setConflict(false);
    try {
      const res = await saveMutation.mutateAsync({
        id: mapping?.id,
        version: mapping?.updatedAt, // updatedAt as optimistic-concurrency token
        connectionId,
        projectKey,
        projectId,
        defaultIssueTypeId: issueTypeId,
        fieldMap,
        statusMap,
        syncRules,
        isDefault: mapping?.isDefault ?? false,
        enabled: mapping?.enabled ?? true,
      });
      onSaved(res.data);
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr.status === 409) {
        setConflict(true);
        return;
      }
      if (apiErr.status === 422 || apiErr.status === 400) {
        // Extract per-path validation errors from details[]
        const details = (apiErr.body as { error?: { details?: { path: string; message: string }[] } })?.error?.details ?? [];
        setValidationErrors(details.map((d: { path: string; message: string }) => ({ path: d.path, message: d.message })));
        return;
      }
      throw err;
    }
  }

  const selectedProject = projectsQuery.data?.data.find((p) => p.key === projectKey);

  return (
    <div>
      {/* 409 conflict banner */}
      {conflict && (
        <div
          role="alert"
          aria-live="assertive"
          style={{
            marginBottom: 14,
            padding: '10px 14px',
            background: '#fef2f2',
            border: '1px solid #fca5a5',
            borderRadius: 6,
            fontSize: 13,
            color: '#dc2626',
          }}
        >
          ⚠ This mapping was updated by another user. Please{' '}
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ color: '#dc2626', fontWeight: 600, background: 'transparent', border: 'none', cursor: 'pointer', textDecoration: 'underline', fontSize: 13 }}
          >
            reload
          </button>{' '}
          and re-apply your changes.
        </div>
      )}

      {/* Connection degraded warning */}
      {!canWrite && (
        <div
          role="status"
          style={{
            marginBottom: 14,
            padding: '8px 12px',
            background: '#fffbeb',
            border: '1px solid #d97706',
            borderRadius: 6,
            fontSize: 13,
            color: '#92400e',
          }}
        >
          You have read-only access. Mapping editing requires the <code>integration:manage</code> permission.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Project selector */}
        <div>
          <label htmlFor="mp-project" style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>
            Jira Project *
          </label>
          {projectsQuery.isLoading && <div style={{ fontSize: 13, color: '#6b7280' }}>Loading projects…</div>}
          {projectsQuery.isError && (
            <div role="alert" style={{ fontSize: 13, color: '#dc2626' }}>
              Failed to load projects: {(projectsQuery.error as ApiError).message}
            </div>
          )}
          {projectsQuery.data && (
            <select
              id="mp-project"
              disabled={!canWrite}
              value={projectKey}
              onChange={(e) => {
                const p = projectsQuery.data.data.find((proj) => proj.key === e.target.value);
                setProjectKey(e.target.value);
                setProjectId(p?.id ?? '');
                setIssueTypeId('');
              }}
              aria-label="Select Jira project"
              style={{
                width: '100%',
                padding: '7px 10px',
                borderRadius: 5,
                border: `1px solid ${getFieldError('projectKey') ? '#dc2626' : 'var(--color-border, #e5e7eb)'}`,
                fontSize: 13,
                background: '#fff',
              }}
            >
              <option value="">— Select project —</option>
              {projectsQuery.data.data.map((p) => (
                <option key={p.key} value={p.key}>{p.name} ({p.key})</option>
              ))}
            </select>
          )}
          {getFieldError('projectKey') && (
            <span role="alert" style={{ fontSize: 11, color: '#dc2626' }}>{getFieldError('projectKey')}</span>
          )}
        </div>

        {/* Issue type selector */}
        {selectedProject && (
          <div>
            <label htmlFor="mp-issuetype" style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>
              Default Issue Type *
            </label>
            <select
              id="mp-issuetype"
              disabled={!canWrite}
              value={issueTypeId}
              onChange={(e) => setIssueTypeId(e.target.value)}
              aria-label="Select default issue type"
              style={{
                width: '100%',
                padding: '7px 10px',
                borderRadius: 5,
                border: `1px solid ${getFieldError('defaultIssueTypeId') ? '#dc2626' : 'var(--color-border, #e5e7eb)'}`,
                fontSize: 13,
                background: '#fff',
              }}
            >
              <option value="">— Select issue type —</option>
              {selectedProject.issueTypes.filter((it) => !it.subtask).map((it) => (
                <option key={it.id} value={it.id}>{it.name}</option>
              ))}
            </select>
            {getFieldError('defaultIssueTypeId') && (
              <span role="alert" style={{ fontSize: 11, color: '#dc2626' }}>{getFieldError('defaultIssueTypeId')}</span>
            )}
          </div>
        )}

        {/* Field mappings */}
        {fieldsQuery.data && (
          <fieldset style={{ border: '1px solid var(--color-border, #e5e7eb)', borderRadius: 6, padding: '12px 14px' }}>
            <legend style={{ fontSize: 13, fontWeight: 600, padding: '0 4px' }}>Field Mappings</legend>
            {fieldsQuery.data.data.map((field) => {
              const existing = fieldMap.find((fm) => fm.target.fieldId === field.id);
              const errPath = `fieldMap.${field.id}`;
              return (
                <div key={field.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <label
                    htmlFor={`fm-${field.id}`}
                    style={{
                      width: 180,
                      fontSize: 13,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      color: field.required ? 'var(--color-fg-primary, #111827)' : 'var(--color-fg-muted, #6b7280)',
                    }}
                    title={field.name}
                  >
                    {field.name}{field.required ? ' *' : ''}
                  </label>
                  <input
                    id={`fm-${field.id}`}
                    type="text"
                    disabled={!canWrite}
                    placeholder={`OpsNinja field key or static value`}
                    value={existing?.source.fieldKey ?? existing?.source.staticValue ?? ''}
                    aria-label={`Mapping for ${field.name}`}
                    aria-invalid={Boolean(getFieldError(errPath))}
                    aria-describedby={getFieldError(errPath) ? `err-${field.id}` : undefined}
                    onChange={(e) => {
                      const val = e.target.value;
                      setFieldMap((prev) => {
                        const filtered = prev.filter((fm) => fm.target.fieldId !== field.id);
                        if (!val) return filtered;
                        return [...filtered, {
                          source: { type: 'ticket_field', fieldKey: val },
                          target: { fieldId: field.id, fieldName: field.name },
                        }];
                      });
                    }}
                    style={{
                      flex: 1,
                      padding: '5px 8px',
                      borderRadius: 4,
                      border: `1px solid ${getFieldError(errPath) ? '#dc2626' : 'var(--color-border, #e5e7eb)'}`,
                      fontSize: 13,
                    }}
                  />
                  {getFieldError(errPath) && (
                    <span id={`err-${field.id}`} role="alert" style={{ fontSize: 11, color: '#dc2626', whiteSpace: 'nowrap' }}>
                      {getFieldError(errPath)}
                    </span>
                  )}
                </div>
              );
            })}
          </fieldset>
        )}

        {/* Sync rule toggles */}
        <fieldset style={{ border: '1px solid var(--color-border, #e5e7eb)', borderRadius: 6, padding: '12px 14px' }}>
          <legend style={{ fontSize: 13, fontWeight: 600, padding: '0 4px' }}>Sync Rules</legend>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: canWrite ? 'pointer' : 'default' }}>
              <input
                type="checkbox"
                disabled={!canWrite}
                checked={syncRules.syncComments}
                onChange={(e) => setSyncRules((r) => ({ ...r, syncComments: e.target.checked }))}
                aria-label="Sync comments to Jira"
              />
              Sync comments to Jira
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: canWrite ? 'pointer' : 'default' }}>
              <input
                type="checkbox"
                disabled={!canWrite}
                checked={syncRules.syncStatusChanges}
                onChange={(e) => setSyncRules((r) => ({ ...r, syncStatusChanges: e.target.checked }))}
                aria-label="Sync status changes to Jira"
              />
              Sync status changes to Jira
            </label>

            <div>
              <label htmlFor="sync-vis" style={{ fontSize: 13, fontWeight: 500 }}>Comment visibility</label>
              <select
                id="sync-vis"
                disabled={!canWrite}
                value={syncRules.commentVisibility}
                onChange={(e) => setSyncRules((r) => ({ ...r, commentVisibility: e.target.value as SyncRules['commentVisibility'] }))}
                style={{ marginLeft: 8, padding: '4px 8px', fontSize: 13, borderRadius: 4, border: '1px solid var(--color-border, #e5e7eb)' }}
              >
                <option value="public">Public only</option>
                <option value="internal">Internal only</option>
                <option value="both">Both</option>
              </select>
            </div>
          </div>
        </fieldset>

        {/* Save */}
        {canWrite && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saveMutation.isPending || !projectKey || !issueTypeId}
              aria-label="Save mapping"
              style={{
                padding: '8px 20px',
                borderRadius: 6,
                border: 'none',
                background: 'var(--color-primary, #4f46e5)',
                color: '#fff',
                fontSize: 13,
                fontWeight: 600,
                cursor: saveMutation.isPending ? 'not-allowed' : 'pointer',
                opacity: (saveMutation.isPending || !projectKey || !issueTypeId) ? 0.6 : 1,
              }}
            >
              {saveMutation.isPending ? 'Saving…' : 'Save Mapping'}
            </button>

            {saveMutation.isError && !conflict && (
              <span role="alert" aria-live="assertive" style={{ fontSize: 13, color: '#dc2626' }}>
                {(saveMutation.error as ApiError).message}
                {(saveMutation.error as ApiError).traceId && (
                  <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 8 }}>
                    Trace: {(saveMutation.error as ApiError).traceId}
                  </span>
                )}
              </span>
            )}

            {saveMutation.isSuccess && (
              <span role="status" aria-live="polite" style={{ fontSize: 13, color: '#16a34a' }}>
                ✓ Saved
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
