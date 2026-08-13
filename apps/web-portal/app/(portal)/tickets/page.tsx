/**
 * Portal tickets list page — WO-090 AC1, AC2, AC9.
 *
 * Renders the TicketListPage feature component which provides:
 *   - Paginated list of the authenticated user's organisation tickets
 *   - Status badge + SLA hint per row
 *   - Allow-listed status and subject search filters
 *   - Cursor pagination
 */

import { TicketListPage } from '../../../src/features/tickets/TicketListPage';

export default function TicketsPage() {
  return <TicketListPage />;
}
