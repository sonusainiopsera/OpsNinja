/**
 * Root layout — minimal HTML wrapper. Theme is applied here via data-theme
 * attribute so server-rendered HTML already carries the right theme class.
 */
import type { Metadata } from 'next';
import React from 'react';

export const metadata: Metadata = {
  title: 'OpsNinja',
  description: 'Support and incident management for platform engineering teams',
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
