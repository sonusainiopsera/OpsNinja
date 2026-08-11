/**
 * Notification Event Catalogue — WO-081.
 *
 * Declarative definition of every outbox event type eligible for email/webhook
 * notification. This is the single source of truth for:
 *   - NotificationRuleResolver: which events to route and to whom
 *   - NotificationPreferencesService: valid event_type values for preferences
 *   - Portal/admin preference controllers: valid eventType choices
 *
 * Adding a new event type requires ONLY a new entry in this catalogue plus a
 * matching template key — no branching logic changes.
 *
 * Audience types:
 *   'customer'  → requester contact + org watchers (customer-facing)
 *   'oncall'    → on-call engineer + assignment-group members (internal SLA)
 *   'both'      → both audiences receive the event
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AudienceType = 'customer' | 'oncall' | 'both';
export type DataClassification = 'public' | 'internal' | 'confidential';
export type PayloadProjectionName = 'ticket_public' | 'ticket_sla' | 'comment_public';

export interface NotificationCatalogueEntry {
  /** Outbox eventType string that triggers this notification. */
  readonly eventType: string;
  /** Human-readable description. */
  readonly description: string;
  /** Who receives this notification. */
  readonly audienceType: AudienceType;
  /** Default delivery channels when no preference row exists. */
  readonly defaultChannels: readonly string[];
  /** Handlebars template key registered in notification_templates. */
  readonly templateKey: string;
  /** Which payload projection function to apply before rendering. */
  readonly payloadProjection: PayloadProjectionName;
  /** Data classification — affects logging and redaction tier. */
  readonly dataClassification: DataClassification;
  /**
   * When true, a comment's visibility field is checked before routing.
   * Events with visibility !== 'public' resolve to an empty customer audience.
   */
  readonly checkCommentVisibility: boolean;
  /**
   * When true, rapid successive events within the 60-second coalescing window
   * are deduplicated per (tenant, ticket, recipient, eventType).
   */
  readonly coalescingEnabled: boolean;
}

// ---------------------------------------------------------------------------
// Catalogue — frozen at module load; validated below
// ---------------------------------------------------------------------------

export const NOTIFICATION_CATALOGUE: readonly NotificationCatalogueEntry[] = Object.freeze([
  {
    eventType: 'ticket.created',
    description: 'A new support ticket was opened.',
    audienceType: 'customer',
    defaultChannels: ['email'],
    templateKey: 'ticket_created',
    payloadProjection: 'ticket_public',
    dataClassification: 'internal',
    checkCommentVisibility: false,
    coalescingEnabled: false,
  },
  {
    eventType: 'ticket.status_changed',
    description: 'Ticket status changed (e.g. open → in_progress).',
    audienceType: 'customer',
    defaultChannels: ['email'],
    templateKey: 'ticket_status_changed',
    payloadProjection: 'ticket_public',
    dataClassification: 'internal',
    checkCommentVisibility: false,
    coalescingEnabled: true, // burst dedup for bulk agent edits
  },
  {
    eventType: 'ticket.comment_added',
    description: 'A comment was added to the ticket. Only public comments notify customers.',
    audienceType: 'customer',
    defaultChannels: ['email'],
    templateKey: 'ticket_comment_added',
    payloadProjection: 'comment_public',
    dataClassification: 'internal',
    checkCommentVisibility: true, // AC-3: internal comments → empty audience
    coalescingEnabled: false,
  },
  {
    eventType: 'ticket.assignee_changed',
    description: 'Ticket assignee changed.',
    audienceType: 'customer',
    defaultChannels: ['email'],
    templateKey: 'ticket_assignee_changed',
    payloadProjection: 'ticket_public',
    dataClassification: 'internal',
    checkCommentVisibility: false,
    coalescingEnabled: true, // burst dedup for rapid re-assignments
  },
  {
    eventType: 'ticket.resolved',
    description: 'Ticket has been resolved.',
    audienceType: 'customer',
    defaultChannels: ['email'],
    templateKey: 'ticket_resolved',
    payloadProjection: 'ticket_public',
    dataClassification: 'internal',
    checkCommentVisibility: false,
    coalescingEnabled: false,
  },
  {
    eventType: 'ticket.reopened',
    description: 'A resolved or closed ticket has been reopened.',
    audienceType: 'customer',
    defaultChannels: ['email'],
    templateKey: 'ticket_reopened',
    payloadProjection: 'ticket_public',
    dataClassification: 'internal',
    checkCommentVisibility: false,
    coalescingEnabled: false,
  },
  {
    eventType: 'sla.reminder_threshold_reached',
    description: 'SLA reminder threshold reached (e.g. 50% or 75% of response time consumed).',
    audienceType: 'oncall',
    defaultChannels: ['email'],
    templateKey: 'sla_reminder',
    payloadProjection: 'ticket_sla',
    dataClassification: 'internal',
    checkCommentVisibility: false,
    coalescingEnabled: false,
  },
  {
    eventType: 'sla.breached',
    description: 'Ticket has breached its SLA response or resolution target.',
    audienceType: 'oncall',
    defaultChannels: ['email'],
    templateKey: 'sla_breached',
    payloadProjection: 'ticket_sla',
    dataClassification: 'internal',
    checkCommentVisibility: false,
    coalescingEnabled: false,
  },
]);

// ---------------------------------------------------------------------------
// Derived structures for O(1) lookup
// ---------------------------------------------------------------------------

/** Map from eventType → CatalogueEntry for O(1) lookup. */
export const CATALOGUE_BY_EVENT_TYPE: ReadonlyMap<string, NotificationCatalogueEntry> = new Map(
  NOTIFICATION_CATALOGUE.map((e) => [e.eventType, e]),
);

/** Set of all valid notification event types. */
export const NOTIFICATION_EVENT_TYPES: ReadonlySet<string> = new Set(
  NOTIFICATION_CATALOGUE.map((e) => e.eventType),
);

// ---------------------------------------------------------------------------
// Validation schema (Zod) — used to validate catalogue shape at module load
// ---------------------------------------------------------------------------

const CatalogueEntrySchema = z.object({
  eventType: z.string().min(1),
  description: z.string().min(1),
  audienceType: z.enum(['customer', 'oncall', 'both']),
  defaultChannels: z.array(z.string()).min(1),
  templateKey: z.string().min(1),
  payloadProjection: z.enum(['ticket_public', 'ticket_sla', 'comment_public']),
  dataClassification: z.enum(['public', 'internal', 'confidential']),
  checkCommentVisibility: z.boolean(),
  coalescingEnabled: z.boolean(),
});

// Validate at module load — any structural error fails CI.
for (const entry of NOTIFICATION_CATALOGUE) {
  CatalogueEntrySchema.parse(entry);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the catalogue entry for a given event type, or null if not found. */
export function getCatalogueEntry(eventType: string): NotificationCatalogueEntry | null {
  return CATALOGUE_BY_EVENT_TYPE.get(eventType) ?? null;
}

/** Returns true if the event type is in the notification catalogue. */
export function isNotificationEligible(eventType: string): boolean {
  return NOTIFICATION_EVENT_TYPES.has(eventType);
}
