/**
 * SubjectExportManifest — WO-096.
 *
 * Declarative registry of every PII-bearing table whose data must be included
 * in an access/portability export for a data subject.  Derived from the
 * classification registry in @opsninja/observability so a newly added
 * confidential table is included by construction rather than by memory.
 *
 * Each entry describes:
 *   - table: the Postgres table name
 *   - subjectColumn: the column that links a row to the data subject
 *   - selectColumns: columns to include in the export (never include secrets
 *     or internal agent-only fields for portal principals)
 *   - visibilityFilter: optional SQL WHERE fragment (unparameterised text that
 *     is safe to embed because it only references literal enum values, not
 *     user input); used to exclude internal agent notes from portal exports
 *
 * Security:
 *   - Portal principals receive only public-visibility data (visibility = 'public').
 *   - Internal agent notes are structurally absent from portal exports because
 *     the manifest entry for ticket_comments carries a visibilityFilter.
 *   - Table names and column names are hardcoded here — they are never sourced
 *     from user input.
 */

export type SubjectType = 'contact' | 'portal_user';

export interface ManifestEntry {
  /** Postgres table name. */
  table: string;
  /** Column that identifies the data subject (parameterised in the query). */
  subjectColumn: string;
  /** Columns to SELECT for the export. Explicit list — no SELECT *. */
  selectColumns: string[];
  /**
   * Optional literal SQL predicate appended with AND to limit rows.
   * Must contain no user-supplied values (constants only).
   */
  visibilityFilter?: string;
  /** Human-readable description for the export manifest header. */
  description: string;
}

/**
 * Returns the export manifest for a given subject type.
 *
 * @param isPortalPrincipal  - When true, internal-only fields are excluded.
 */
export function buildSubjectExportManifest(isPortalPrincipal: boolean): ManifestEntry[] {
  return [
    // ── Contacts / identity ──────────────────────────────────────────────────
    {
      table:         'contacts',
      subjectColumn: 'id',
      selectColumns: ['id', 'tenant_id', 'first_name', 'last_name', 'email',
                      'phone', 'created_at', 'updated_at'],
      description:   'Contact profile data',
    },
    {
      table:         'portal_users',
      subjectColumn: 'id',
      selectColumns: ['id', 'tenant_id', 'email', 'organization_id', 'created_at'],
      description:   'Portal user account',
    },

    // ── Tickets ──────────────────────────────────────────────────────────────
    {
      table:         'tickets',
      subjectColumn: 'contact_id',
      selectColumns: ['id', 'tenant_id', 'subject', 'status', 'priority',
                      'organization_id', 'created_at', 'updated_at', 'resolved_at'],
      description:   'Support tickets',
    },

    // ── Comments (public only for portal principals) ─────────────────────────
    {
      table:          'ticket_comments',
      subjectColumn:  'author_id',
      selectColumns:  ['id', 'ticket_id', 'body', 'visibility', 'created_at', 'updated_at'],
      visibilityFilter: isPortalPrincipal ? "visibility = 'public'" : undefined,
      description:    isPortalPrincipal
        ? 'Public comments authored by subject'
        : 'Comments authored by subject',
    },

    // ── Attachments metadata (no binary content) ─────────────────────────────
    {
      table:         'ticket_attachments',
      subjectColumn: 'uploaded_by',
      selectColumns: ['id', 'ticket_id', 'filename', 'content_type',
                      'size_bytes', 'created_at'],
      description:   'Attachment metadata (filenames only, no binary data)',
    },

    // ── CSAT responses ────────────────────────────────────────────────────────
    {
      table:         'csat_surveys',
      subjectColumn: 'contact_id',
      selectColumns: ['id', 'tenant_id', 'score', 'comment', 'responded_at', 'created_at'],
      description:   'CSAT survey responses',
    },

    // ── Audit records referencing the subject ─────────────────────────────────
    {
      table:         'audit_logs',
      subjectColumn: 'actor_id',
      selectColumns: ['id', 'event_type', 'action', 'resource_type', 'resource_id',
                      'changed_fields', 'trace_id', 'created_at'],
      description:   'Audit trail entries attributed to subject',
    },

    // ── Notifications sent to the subject ─────────────────────────────────────
    {
      table:         'notifications',
      subjectColumn: 'recipient_email',
      selectColumns: ['id', 'tenant_id', 'template_slug', 'status', 'sent_at', 'created_at'],
      description:   'Notification history',
    },
  ];
}

/**
 * Returns all table names covered by the manifest (both principal types).
 * Used by CI completeness tests to assert coverage against the classification
 * registry.
 */
export function allManifestTables(): string[] {
  // Union of both principal type manifests.
  const staff  = buildSubjectExportManifest(false).map((e) => e.table);
  const portal = buildSubjectExportManifest(true).map((e) => e.table);
  return [...new Set([...staff, ...portal])];
}
