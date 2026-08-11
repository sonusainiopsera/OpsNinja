import type {
  PortalPrincipal,
  PortalOrganization,
  PendingSurvey,
  PortalIdentityResponse,
} from '../../lib/api/client';

export const ORG_WITH_LOGO: PortalOrganization = {
  id: 'org-001',
  name: 'Acme Corp',
  logoUrl: 'https://example.com/acme-logo.png',
};

export const ORG_WITHOUT_LOGO: PortalOrganization = {
  id: 'org-002',
  name: 'Globex Inc',
  logoUrl: undefined,
};

export const PORTAL_PRINCIPAL_WITH_LOGO: PortalPrincipal = {
  id: 'user-001',
  name: 'Jane Doe',
  email: 'jane@acme.com',
  organization: ORG_WITH_LOGO,
};

export const PORTAL_PRINCIPAL_WITHOUT_LOGO: PortalPrincipal = {
  id: 'user-002',
  name: 'John Smith',
  email: 'john@globex.com',
  organization: ORG_WITHOUT_LOGO,
};

export const PENDING_SURVEY: PendingSurvey = {
  id: 'survey-2024-q1',
  ticketId: 'TKT-999',
  ticketSubject: 'Login issues with SSO provider',
};

export const IDENTITY_WITH_SURVEY: PortalIdentityResponse = {
  principal: PORTAL_PRINCIPAL_WITH_LOGO,
  pendingSurvey: PENDING_SURVEY,
};

export const IDENTITY_WITHOUT_SURVEY: PortalIdentityResponse = {
  principal: PORTAL_PRINCIPAL_WITHOUT_LOGO,
  pendingSurvey: null,
};
