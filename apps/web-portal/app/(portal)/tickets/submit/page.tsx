import { redirect } from 'next/navigation';

/** Legacy/mistyped path — submit lives at /submit, not under /tickets. */
export default function TicketsSubmitRedirectPage() {
  redirect('/submit');
}
