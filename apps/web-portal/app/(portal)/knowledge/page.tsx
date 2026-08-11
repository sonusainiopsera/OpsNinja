import React from 'react';

export default function KnowledgePage() {
  return (
    <section aria-labelledby="knowledge-heading" style={{ padding: 24 }}>
      <h1 id="knowledge-heading" style={{ margin: '0 0 16px', fontSize: 22, fontWeight: 600 }}>
        Knowledge Base
      </h1>
      <p style={{ color: 'var(--portal-fg-muted, #6b7280)' }}>
        Browse articles and documentation.
      </p>
    </section>
  );
}
