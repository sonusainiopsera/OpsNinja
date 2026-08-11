import React from 'react';
import { SkipToContent } from '../../components/shell/SkipToContent';
import { PortalShell } from '../../components/shell/PortalShell';

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SkipToContent />
      <PortalShell>{children}</PortalShell>
    </>
  );
}
