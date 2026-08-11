import type { OrgScopeResult } from '../../lib/api/identity';

export const SINGLE_ORG_SCOPE: OrgScopeResult = {
  current: { id: 'org_001', name: 'Acme Corp' },
  available: [{ id: 'org_001', name: 'Acme Corp' }],
};

export const MULTI_ORG_SCOPE: OrgScopeResult = {
  current: { id: 'org_001', name: 'Acme Corp' },
  available: [
    { id: 'org_001', name: 'Acme Corp' },
    { id: 'org_002', name: 'Globex Industries' },
    { id: 'org_003', name: 'Springfield Nuclear' },
    { id: 'org_004', name: 'Initech Solutions Ltd' },
    { id: 'org_005', name: 'Umbrella Corporation EMEA' },
  ],
};

export const EMPTY_ORG_SCOPE: OrgScopeResult = {
  current: null,
  available: [],
};
