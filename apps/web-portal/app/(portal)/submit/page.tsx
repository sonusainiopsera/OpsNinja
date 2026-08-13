'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';

/**
 * Submit page — portal ticket submission (WO-089).
 *
 * Renders the NewRequestForm for onboarded portal users.
 * The form is loaded client-side only (dynamic import with ssr:false) because
 * it depends on browser APIs (FormData, XHR) for direct-to-storage uploads.
 */

const NewRequestForm = dynamic(
  () => import('../../../src/features/tickets/NewRequestForm'),
  { ssr: false, loading: () => <p>Loading form…</p> },
);

export default function SubmitPage() {
  const router = useRouter();

  const handleSuccess = React.useCallback(
    (ticketId: string, reference: string) => {
      router.push(`/tickets/${ticketId}?ref=${encodeURIComponent(reference)}`);
    },
    [router],
  );

  return (
    <section aria-labelledby="submit-heading" style={{ padding: 24 }}>
      <h1 id="submit-heading" style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 600 }}>
        Submit a Support Request
      </h1>
      <p style={{ marginTop: 0, marginBottom: 24, color: 'var(--portal-fg-muted, #6b7280)' }}>
        Describe your issue in as much detail as possible. Attach relevant logs,
        screenshots or pipeline output to help us resolve it quickly.
      </p>

      <NewRequestForm onSuccess={handleSuccess} />
    </section>
  );
}
