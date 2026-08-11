export default function DashboardPage() {
  return (
    <div style={{ padding: 32 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8, color: 'var(--color-fg-primary, #111827)' }}>
        Dashboard
      </h1>
      <p style={{ color: 'var(--color-muted, #6b7280)', fontSize: 14 }}>
        Real-time operational overview. Content loaded by feature epics.
      </p>
    </div>
  );
}
