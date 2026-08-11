import React from 'react';

export default function SubmitPage() {
  return (
    <section aria-labelledby="submit-heading" style={{ padding: 24 }}>
      <h1 id="submit-heading" style={{ margin: '0 0 16px', fontSize: 22, fontWeight: 600 }}>
        Submit Request
      </h1>
      <p style={{ color: 'var(--portal-fg-muted, #6b7280)' }}>
        Submit a new support request.
      </p>
    </section>
  );
}
