/**
 * Authenticated route group layout.
 *
 * This server component wraps all authenticated agent routes in AppShell.
 * It stays a server component at the root level; AppShell ('use client') owns
 * the interactive chrome so static landmarks are server-rendered.
 *
 * Landmark structure (per WCAG 2.1):
 *   <header role="banner">  — rendered by TopBar
 *   <nav role="navigation"> — rendered by Sidebar
 *   <main role="main">      — rendered by AppShell, hosts page content
 *   <footer role="contentinfo"> — rendered by AppShell
 */

import React from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { SkipToContent } from '@/components/shell/SkipToContent';

export const metadata = {
  title: { default: 'OpsNinja', template: '%s | OpsNinja' },
  description: 'Support and incident management for platform engineering teams',
};

export default function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {/* First focusable element on every page */}
      <SkipToContent />
      <AppShell>{children}</AppShell>
    </>
  );
}
