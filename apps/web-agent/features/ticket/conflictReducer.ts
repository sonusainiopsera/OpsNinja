/**
 * conflictReducer — WO-042.
 *
 * Manages optimistic property edits with safe 409-conflict handling.
 *
 * Rules:
 *   - Every PATCH carries the last known version number.
 *   - A 409 response sets conflict=true and records the server version.
 *   - The agent's unsaved input is NEVER discarded on conflict.
 *   - MERGE re-fetches then re-applies the local edits into the form.
 *   - DISMISS clears the conflict banner without discarding edits.
 *   - RESET clears all local edits after a successful save or explicit clear.
 */

import type { TicketPriority, TicketDetail } from '../../lib/api/tickets/types';

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

export interface PropertyFields {
  priority:       TicketPriority | null;
  assigneeUserId: string | null;
  categoryId:     string | null;
  tags:           string[];
  customFields:   Record<string, unknown>;
}

export interface ConflictState {
  /** Local edits made by the agent since last successful save. */
  localEdits: Partial<PropertyFields>;
  /** True when the last PATCH returned 409. */
  conflict: boolean;
  /** Server-reported version from the 409 response (for display). */
  serverVersion: number | null;
  /** Last known version used in outgoing PATCH requests. */
  currentVersion: number;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type ConflictAction =
  | { type: 'EDIT'; field: keyof PropertyFields; value: PropertyFields[keyof PropertyFields] }
  | { type: 'SAVE_START' }
  | { type: 'SAVE_SUCCESS'; serverVersion: number }
  | { type: 'SAVE_CONFLICT'; serverVersion: number }
  | { type: 'MERGE'; serverData: TicketDetail }
  | { type: 'DISMISS_CONFLICT' }
  | { type: 'RESET' };

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function conflictReducer(state: ConflictState, action: ConflictAction): ConflictState {
  switch (action.type) {
    case 'EDIT':
      return {
        ...state,
        localEdits: { ...state.localEdits, [action.field]: action.value },
      };

    case 'SAVE_START':
      // No state change — optimism is handled externally by the mutation
      return state;

    case 'SAVE_SUCCESS':
      return {
        ...state,
        currentVersion: action.serverVersion,
        localEdits:     {},
        conflict:       false,
        serverVersion:  null,
      };

    case 'SAVE_CONFLICT':
      return {
        ...state,
        conflict:      true,
        serverVersion: action.serverVersion,
        // localEdits preserved — agent input never silently discarded
      };

    case 'MERGE': {
      // Re-base on the refreshed server data while preserving local edits.
      return {
        ...state,
        currentVersion: action.serverData.version,
        conflict:       false,
        serverVersion:  null,
        // Keep localEdits so the agent can review and re-submit
      };
    }

    case 'DISMISS_CONFLICT':
      return { ...state, conflict: false, serverVersion: null };

    case 'RESET':
      return {
        ...state,
        localEdits:    {},
        conflict:      false,
        serverVersion: null,
      };

    default:
      return state;
  }
}

export function makeInitialConflictState(ticket: TicketDetail): ConflictState {
  return {
    localEdits:     {},
    conflict:       false,
    serverVersion:  null,
    currentVersion: ticket.version,
  };
}
