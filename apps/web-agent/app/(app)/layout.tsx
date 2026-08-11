/**
 * Authenticated route group layout.
 * Server component — renders the AppShell around all authenticated routes.
 * Client interactivity is handled inside AppShell itself (marked 'use client').
 */

import React from 'react';
import { Providers } from '../providers';
import { AppShell } from '../../components/shell/AppShell';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <AppShell>{children}</AppShell>
    </Providers>
  );
}
