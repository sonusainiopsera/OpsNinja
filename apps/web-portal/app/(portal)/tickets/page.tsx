import React from 'react';

export default function TicketsPage() {
  return (
    <section aria-labelledby="tickets-heading" style={{ padding: 24 }}>
      <h1 id="tickets-heading" style={{ margin: '0 0 16px', fontSize: 22, fontWeight: 600 }}>
        My Tickets
      </h1>
      <p style={{ color: 'var(--portal-fg-muted, #6b7280)' }}>
        Your support tickets will appear here.
      </p>
    </section>
  );
}
