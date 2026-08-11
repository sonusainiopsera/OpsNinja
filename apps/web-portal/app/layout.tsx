import React from 'react';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'OpsNinja Customer Portal',
  description: 'Submit and track your support requests',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        {children}
      </body>
    </html>
  );
}
