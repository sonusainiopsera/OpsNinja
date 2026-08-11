'use client';

/**
 * OrgScopePill — read-only organization scope indicator.
 *
 * A portal user belongs to exactly one organization.
 * There is deliberately NO interactive picker here.
 */

import React from 'react';
import { OrgChip } from '@opsninja/ui-kit/portal';
import type { PortalOrganization } from '../../lib/api/client';

interface OrgScopePillProps {
  organization: PortalOrganization;
}

export function OrgScopePill({ organization }: OrgScopePillProps) {
  return (
    <div
      aria-label={`Your organization: ${organization.name}`}
      data-testid="org-scope-pill"
      style={{ display: 'inline-flex', alignItems: 'center' }}
    >
      <OrgChip
        name={organization.name}
        avatarUrl={organization.logoUrl}
        maxLength={24}
      />
    </div>
  );
}
