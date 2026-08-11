/**
 * Ticket detail route — /tickets/[id] — WO-042.
 */

import { TicketDetailPage } from '../../../../features/ticket/TicketDetailPage';

interface Props {
  params: { id: string };
}

export function generateMetadata({ params }: Props) {
  return { title: `Ticket ${params.id} – OpsNinja` };
}

export default function Page({ params }: Props) {
  return <TicketDetailPage ticketId={params.id} />;
}
