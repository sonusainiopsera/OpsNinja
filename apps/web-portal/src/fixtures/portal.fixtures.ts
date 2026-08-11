import type {
  PortalPrincipal,
  PortalOrg,
  PortalIdentityResponse,
  PendingCsatSurvey,
} from '../../lib/identity/usePortalIdentity';

export const orgWithLogo: PortalOrg = {
  id: 'org-001',
  name: 'Acme Corporation',
  logoUrl: 'https://cdn.example.com/logos/acme.png',
};

export const orgWithoutLogo: PortalOrg = {
  id: 'org-002',
  name: 'Globex Inc',
  logoUrl: null,
};

export const orgWithLongName: PortalOrg = {
  id: 'org-003',
  name: 'The Very Long Organization Name That Will Overflow Its Container',
  logoUrl: null,
};

export const portalPrincipal: PortalPrincipal = {
  id: 'user-portal-001',
  name: 'Jane Customer',
  email: 'jane@acme.example.com',
  org: orgWithLogo,
};

export const portalPrincipalNoLogo: PortalPrincipal = {
  id: 'user-portal-002',
  name: 'Bob User',
  email: 'bob@globex.example.com',
  org: orgWithoutLogo,
};

export const pendingCsatSurvey: PendingCsatSurvey = {
  surveyId: 'survey-abc-123',
  ticketId: 'ticket-567',
  prompt: 'How was your support experience? Please take a moment to share your feedback.',
  surveyUrl: 'https://surveys.example.com/s/abc-123',
};

export const portalIdentityWithSurvey: PortalIdentityResponse = {
  principal: portalPrincipal,
  pendingSurvey: pendingCsatSurvey,
};

export const portalIdentityNoSurvey: PortalIdentityResponse = {
  principal: portalPrincipal,
  pendingSurvey: null,
};

export const portalIdentityNoLogo: PortalIdentityResponse = {
  principal: portalPrincipalNoLogo,
  pendingSurvey: null,
};
