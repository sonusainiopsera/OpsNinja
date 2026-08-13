/**
 * Portal ticket detail page — WO-090 AC3, AC4, AC7, AC9.
 *
 * Renders the TicketDetailPage feature component which provides:
 *   - Ticket metadata with status badge and SLA hint
 *   - Public comment thread only (internal notes absent at API layer)
 *   - Attachment links (pre-signed download via ownership check)
 *   - Status history timeline
 *   - Reply composer (forced public visibility)
 *   - 404 rendering as "not found" — never as a permission message
 */

import { TicketDetailPage } from '../../../../src/features/tickets/TicketDetailPage';

interface TicketDetailRouteProps {
  params: { id: string };
}

export default function TicketDetailRoute({ params }: TicketDetailRouteProps) {
  return <TicketDetailPage ticketId={params.id} />;
}
