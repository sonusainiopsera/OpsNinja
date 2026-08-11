/**
 * transition-table.ts — declarative ticket lifecycle transition matrix.
 *
 * Each entry maps (fromStatus → toStatus) to the metadata required to
 * execute that transition:
 *   - requiredPermission: the Permission the actor must hold.
 *   - slaPause: true when the transition should pause the SLA clock.
 *   - slaResume: true when the transition should resume the SLA clock.
 *   - events: ordered list of outbox event types emitted on this transition.
 *
 * This module has ZERO framework imports so it can be exercised in pure
 * unit tests without the NestJS DI container or a database connection.
 */

import type { TicketStatus } from '@opsninja/db';
import type { Permission } from '../../../common/auth/permission.catalog';
import { TICKET_EVENTS, type TicketEventType } from '../events/ticket-events';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TransitionRule {
  /** The permission required to execute this transition. */
  requiredPermission: Permission;
  /** Whether the SLA clock should be paused on this transition. */
  slaPause: boolean;
  /** Whether the SLA clock should be resumed on this transition. */
  slaResume: boolean;
  /** Outbox events emitted (in order) when this transition commits. */
  events: TicketEventType[];
}

/**
 * Key format: `${fromStatus}→${toStatus}`
 * Undefined key means the transition is not allowed.
 */
export type TransitionKey = `${TicketStatus}→${TicketStatus}`;
export type TransitionTable = ReadonlyMap<TransitionKey, TransitionRule>;

// ---------------------------------------------------------------------------
// Table definition
// ---------------------------------------------------------------------------

/**
 * Build the transition key for a (from, to) pair.
 * Exported so callers never hand-construct the key format.
 */
export function transitionKey(from: TicketStatus, to: TicketStatus): TransitionKey {
  return `${from}→${to}` as TransitionKey;
}

/** Status change events always emitted when from ≠ to. */
const STATUS_CHANGED_EVENT: TicketEventType[] = [TICKET_EVENTS.STATUS_CHANGED];

/**
 * The single source of truth for every legal lifecycle transition.
 *
 * Lifecycle overview:
 *   new → open → pending_customer → open
 *                                 → resolved → closed
 *   new → resolved (fast path)
 *   closed → open (admin reopen)
 *
 * SLA rules:
 *   - pending_customer / pending_engineering: clock pauses
 *   - returning to open from any pending state: clock resumes
 *   - reopening resolved/closed: clock resumes
 */
const TRANSITION_ENTRIES: [TransitionKey, TransitionRule][] = [
  // ── From: new ──────────────────────────────────────────────────────────────
  [
    transitionKey('new', 'open'),
    { requiredPermission: 'ticket:update', slaPause: false, slaResume: false, events: STATUS_CHANGED_EVENT },
  ],
  [
    transitionKey('new', 'pending_customer'),
    { requiredPermission: 'ticket:update', slaPause: true, slaResume: false, events: STATUS_CHANGED_EVENT },
  ],
  [
    transitionKey('new', 'pending_engineering'),
    { requiredPermission: 'ticket:update', slaPause: true, slaResume: false, events: STATUS_CHANGED_EVENT },
  ],
  [
    transitionKey('new', 'resolved'),
    { requiredPermission: 'ticket:update', slaPause: false, slaResume: false, events: [...STATUS_CHANGED_EVENT, TICKET_EVENTS.RESOLVED] },
  ],

  // ── From: open ─────────────────────────────────────────────────────────────
  [
    transitionKey('open', 'pending_customer'),
    { requiredPermission: 'ticket:update', slaPause: true, slaResume: false, events: STATUS_CHANGED_EVENT },
  ],
  [
    transitionKey('open', 'pending_engineering'),
    { requiredPermission: 'ticket:update', slaPause: true, slaResume: false, events: STATUS_CHANGED_EVENT },
  ],
  [
    transitionKey('open', 'resolved'),
    { requiredPermission: 'ticket:update', slaPause: false, slaResume: false, events: [...STATUS_CHANGED_EVENT, TICKET_EVENTS.RESOLVED] },
  ],
  [
    transitionKey('open', 'closed'),
    { requiredPermission: 'ticket:close', slaPause: false, slaResume: false, events: STATUS_CHANGED_EVENT },
  ],

  // ── From: pending_customer ─────────────────────────────────────────────────
  [
    transitionKey('pending_customer', 'open'),
    { requiredPermission: 'ticket:update', slaPause: false, slaResume: true, events: STATUS_CHANGED_EVENT },
  ],
  [
    transitionKey('pending_customer', 'pending_engineering'),
    { requiredPermission: 'ticket:update', slaPause: false, slaResume: false, events: STATUS_CHANGED_EVENT },
  ],
  [
    transitionKey('pending_customer', 'resolved'),
    { requiredPermission: 'ticket:update', slaPause: false, slaResume: false, events: [...STATUS_CHANGED_EVENT, TICKET_EVENTS.RESOLVED] },
  ],
  [
    transitionKey('pending_customer', 'closed'),
    { requiredPermission: 'ticket:close', slaPause: false, slaResume: false, events: STATUS_CHANGED_EVENT },
  ],

  // ── From: pending_engineering ──────────────────────────────────────────────
  [
    transitionKey('pending_engineering', 'open'),
    { requiredPermission: 'ticket:update', slaPause: false, slaResume: true, events: STATUS_CHANGED_EVENT },
  ],
  [
    transitionKey('pending_engineering', 'pending_customer'),
    { requiredPermission: 'ticket:update', slaPause: false, slaResume: false, events: STATUS_CHANGED_EVENT },
  ],
  [
    transitionKey('pending_engineering', 'resolved'),
    { requiredPermission: 'ticket:update', slaPause: false, slaResume: false, events: [...STATUS_CHANGED_EVENT, TICKET_EVENTS.RESOLVED] },
  ],
  [
    transitionKey('pending_engineering', 'closed'),
    { requiredPermission: 'ticket:close', slaPause: false, slaResume: false, events: STATUS_CHANGED_EVENT },
  ],

  // ── From: resolved ────────────────────────────────────────────────────────
  [
    transitionKey('resolved', 'open'),
    { requiredPermission: 'ticket:update', slaPause: false, slaResume: true, events: STATUS_CHANGED_EVENT },
  ],
  [
    transitionKey('resolved', 'closed'),
    { requiredPermission: 'ticket:close', slaPause: false, slaResume: false, events: STATUS_CHANGED_EVENT },
  ],

  // ── From: closed ──────────────────────────────────────────────────────────
  [
    transitionKey('closed', 'open'),
    { requiredPermission: 'ticket:close', slaPause: false, slaResume: true, events: STATUS_CHANGED_EVENT },
  ],
];

export const TRANSITION_TABLE: TransitionTable = new Map(TRANSITION_ENTRIES);
