/**
 * Zod DTOs for JiraLinks endpoints — WO-053.
 * .strict() rejects unknown properties (defence against injection).
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// POST /tickets/:ticketId/jira-links
// ---------------------------------------------------------------------------

export const EscalateLinkSchema = z.object({
  /** 'create' — create a new Jira issue; 'link_existing' — attach to existing issue. */
  mode: z.enum(['create', 'link_existing']),
  /** ID of the jira_project_mapping to use. Must be enabled and belong to this tenant. */
  mappingId: z.string().uuid(),
  /** Override Jira issue type id; uses mapping.defaultIssueTypeId when absent. */
  issueTypeId: z.string().min(1).optional(),
  /** Required when mode='link_existing': the Jira issue key e.g. 'PLAT-42'. */
  issueKey: z.string().regex(/^[A-Z][A-Z0-9_]+-\d+$/).optional(),
  /** When true, include internal agent notes in the Jira description (mapping must also allow it). */
  includeInternalNotes: z.boolean().default(false),
}).strict().superRefine((val, ctx) => {
  if (val.mode === 'link_existing' && !val.issueKey) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'issueKey is required when mode is link_existing',
      path: ['issueKey'],
    });
  }
});

export type EscalateLinkDto = z.infer<typeof EscalateLinkSchema>;

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

export interface JiraLinkResponse {
  id: string;
  ticketId: string;
  connectionId: string;
  mappingId: string;
  projectKey: string;
  jiraIssueId: string | null;
  jiraIssueKey: string | null;
  jiraIssueUrl: string | null;
  jiraStatus: string | null;
  jiraAssignee: string | null;
  linkState: string;
  mode: string;
  lastSyncedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface JiraLinksListResponse {
  data: JiraLinkResponse[];
}

export interface EscalateLinkResponse {
  link: Pick<JiraLinkResponse, 'id' | 'linkState' | 'ticketId' | 'mappingId' | 'projectKey'>;
}
