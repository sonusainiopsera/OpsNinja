import type { Metadata } from 'next';
import React from 'react';

export const metadata: Metadata = {
  title: 'OpsNinja Portal',
  description: 'Customer support portal — submit requests, track tickets and browse knowledge',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light">
      <head />
      <body
        style={{
          margin: 0,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          background: 'var(--color-page-bg, #f9fafb)',
          color: 'var(--color-text, #111827)',
        }}
      >
        {children}
      </body>
    </html>
  );
}
