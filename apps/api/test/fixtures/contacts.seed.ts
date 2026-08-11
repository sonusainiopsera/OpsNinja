/**
 * Contact fixtures for integration tests — WO-027.
 *
 * 30 contacts across 3 organizations, all using synthetic email addresses
 * (@example.invalid domain) to satisfy the PII anonymisation constraint.
 *
 * tenant_id and organization_id values intentionally share the pattern used
 * by existing test fixtures so queries join cleanly.
 *
 * CSV_VALID_ROWS / CSV_INVALID_ROW exported for import endpoint tests.
 */

export const TENANT_ID = '00000000-0000-0000-0000-000000000001';

export const ORG_IDS = {
  alpha:   '00000000-0000-0000-0001-000000000001',
  beta:    '00000000-0000-0000-0001-000000000002',
  gamma:   '00000000-0000-0000-0001-000000000003',
} as const;

// ---------------------------------------------------------------------------
// 30 contacts split across 3 orgs (10 each)
// ---------------------------------------------------------------------------

export type ContactSeed = {
  id:                  string;
  tenantId:            string;
  organizationId:      string;
  email:               string;
  fullName:            string;
  jobTitle:            string | null;
  phone:               string | null;
  portalAccessEnabled: boolean;
  status:              'active' | 'suspended' | 'inactive';
  version:             number;
};

function makeContacts(
  orgId: string,
  orgPrefix: string,
  count: number,
  startIndex: number,
): ContactSeed[] {
  return Array.from({ length: count }, (_, i) => {
    const n = startIndex + i + 1;
    return {
      id:                  `00000000-0000-0000-0002-${String(n).padStart(12, '0')}`,
      tenantId:            TENANT_ID,
      organizationId:      orgId,
      email:               `contact${n}@${orgPrefix}.example.invalid`,
      fullName:            `Contact ${orgPrefix.toUpperCase()} ${n}`,
      jobTitle:            n % 3 === 0 ? 'Engineer' : null,
      phone:               n % 4 === 0 ? `+1555000${String(n).padStart(4, '0')}` : null,
      portalAccessEnabled: n % 2 === 0,
      status:              n === 5 ? 'suspended' : 'active',
      version:             1,
    } satisfies ContactSeed;
  });
}

export const CONTACT_SEEDS: ContactSeed[] = [
  ...makeContacts(ORG_IDS.alpha, 'alpha', 10, 0),
  ...makeContacts(ORG_IDS.beta,  'beta',  10, 10),
  ...makeContacts(ORG_IDS.gamma, 'gamma', 10, 20),
];

// ---------------------------------------------------------------------------
// Sample import CSV (valid and invalid rows)
// ---------------------------------------------------------------------------

export const CSV_VALID_ROWS = [
  'fullName,email,jobTitle,phone,portalAccessEnabled',
  'Import Alice,alice.import@import.example.invalid,QA Engineer,+15550001234,true',
  'Import Bob,bob.import@import.example.invalid,,',
  'Import Carol,carol.import@import.example.invalid,Manager,+15550005678,false',
].join('\n');

export const CSV_WITH_INVALID_ROW = [
  'fullName,email,jobTitle',
  'Valid Row,valid@import.example.invalid,Engineer',
  'Bad Email Row,NOT_AN_EMAIL,Tester',
  'Also Valid,also@import.example.invalid,',
].join('\n');

export const CSV_WITH_DUPLICATE = [
  'fullName,email',
  'Alice,dup@import.example.invalid',
  'AliceDup,dup@import.example.invalid',
].join('\n');
