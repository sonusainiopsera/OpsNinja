import React from 'react';
import { Providers } from '../providers';
import { PortalShell } from '../../components/shell/PortalShell';

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <PortalShell>{children}</PortalShell>
    </Providers>
  );
}
