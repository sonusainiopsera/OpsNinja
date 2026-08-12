/**
 * Unit tests for the Jira mapping Zod schemas — WO-052 AC9.
 *
 * Pure validation tests — no DB, no Redis, no HTTP calls.
 *
 * Coverage:
 *   - fieldMap source allow-list enforcement (unknown source rejected)
 *   - static source: staticValue required; non-static: staticValue forbidden
 *   - statusMap: at least one of jiraStatusId / jiraStatusCategory required
 *   - statusMap: opsninjaStatus must be in the OpsNinja status enum
 *   - CreateMappingSchema strict mode: unknown top-level fields rejected
 *   - CreateMappingSchema: projectKey regex (uppercase alphanumeric, leading letter)
 *   - CreateMappingSchema: fieldMap size cap (max 50)
 *   - UpdateMappingSchema: all fields optional; connectionId omitted (immutable)
 *   - ListMappingsQuerySchema: limit coercion and caps
 *   - DiscoveryQuerySchema: refresh string → boolean coercion
 */

import {
  CreateMappingSchema,
  UpdateMappingSchema,
  ListMappingsQuerySchema,
  DiscoveryQuerySchema,
  MAPPING_SOURCES,
  OPSNINJA_STATUSES,
} from '../../src/modules/jira/mapping/jira-mapping.schema';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CONN_ID = 'a0000000-0000-0000-0000-000000000001';

/** Base valid mapping payload — all required fields present. */
function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    connectionId: CONN_ID,
    projectKey: 'PLAT',
    projectId: '10000',
    defaultIssueTypeId: '10001',
    fieldMap: [
      { source: 'ticket.title', target: { fieldId: 'summary', schemaType: 'string' } },
      {
        source: 'ticket.priority',
        target: { fieldId: 'priority', schemaType: 'priority' },
        transform: 'priority_to_jira',
      },
    ],
    statusMap: [{ jiraStatusId: 'done', opsninjaStatus: 'resolved' }],
    syncRules: {
      applyInboundStatus: true,
      applyInboundComments: true,
      autoResolveOnJiraDone: false,
      commentVisibility: 'internal',
    },
    isDefault: false,
    enabled: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// CreateMappingSchema — happy path
// ---------------------------------------------------------------------------

describe('CreateMappingSchema — valid payloads', () => {
  it('accepts a fully-specified valid mapping', () => {
    expect(CreateMappingSchema.safeParse(validPayload()).success).toBe(true);
  });

  it('applies default syncRules when omitted', () => {
    const result = CreateMappingSchema.safeParse(validPayload({ syncRules: undefined }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.syncRules.applyInboundStatus).toBe(true);
      expect(result.data.syncRules.commentVisibility).toBe('internal');
      expect(result.data.syncRules.autoResolveOnJiraDone).toBe(false);
    }
  });

  it('applies isDefault=false and enabled=true as defaults', () => {
    const result = CreateMappingSchema.safeParse(validPayload({ isDefault: undefined, enabled: undefined }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isDefault).toBe(false);
      expect(result.data.enabled).toBe(true);
    }
  });

  it('accepts empty fieldMap and statusMap', () => {
    expect(CreateMappingSchema.safeParse(validPayload({ fieldMap: [], statusMap: [] })).success).toBe(true);
  });

  it('accepts all allow-listed source values', () => {
    for (const source of MAPPING_SOURCES) {
      const entry =
        source === 'static'
          ? { source, staticValue: 'fixed-value', target: { fieldId: 'f', schemaType: 'string' } }
          : { source, target: { fieldId: 'f', schemaType: 'string' } };
      const result = CreateMappingSchema.safeParse(validPayload({ fieldMap: [entry] }));
      expect(result.success).toBe(true);
    }
  });

  it('accepts all OpsNinja statuses in statusMap', () => {
    for (const status of OPSNINJA_STATUSES) {
      const result = CreateMappingSchema.safeParse(
        validPayload({ statusMap: [{ jiraStatusId: 'done', opsninjaStatus: status }] }),
      );
      expect(result.success).toBe(true);
    }
  });

  it('accepts statusMap entry with only jiraStatusCategory (no jiraStatusId)', () => {
    const result = CreateMappingSchema.safeParse(
      validPayload({ statusMap: [{ jiraStatusCategory: 'done', opsninjaStatus: 'resolved' }] }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts static fieldMap entry with staticValue', () => {
    const result = CreateMappingSchema.safeParse(
      validPayload({
        fieldMap: [{ source: 'static', staticValue: 'OpsNinja', target: { fieldId: 'components', schemaType: 'array' } }],
      }),
    );
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CreateMappingSchema — rejection paths
// ---------------------------------------------------------------------------

describe('CreateMappingSchema — rejection paths', () => {
  it('rejects unknown top-level field (strict mode)', () => {
    expect(CreateMappingSchema.safeParse(validPayload({ extraField: 'x' })).success).toBe(false);
  });

  it('rejects non-UUID connectionId', () => {
    expect(CreateMappingSchema.safeParse(validPayload({ connectionId: 'not-a-uuid' })).success).toBe(false);
  });

  it('rejects lowercase projectKey', () => {
    expect(CreateMappingSchema.safeParse(validPayload({ projectKey: 'plat' })).success).toBe(false);
  });

  it('rejects projectKey starting with a digit', () => {
    expect(CreateMappingSchema.safeParse(validPayload({ projectKey: '1PLAT' })).success).toBe(false);
  });

  it('rejects fieldMap entry with unknown source', () => {
    const result = CreateMappingSchema.safeParse(
      validPayload({
        fieldMap: [{ source: 'ticket.internal_secret', target: { fieldId: 'summary', schemaType: 'string' } }],
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      // Error message must enumerate allowed sources
      const msg = result.error.issues[0]?.message ?? '';
      expect(msg).toContain('ticket.title');
    }
  });

  it('rejects fieldMap entry with unknown extra field (strict)', () => {
    const result = CreateMappingSchema.safeParse(
      validPayload({
        fieldMap: [
          { source: 'ticket.title', target: { fieldId: 'summary', schemaType: 'string' }, secretParam: 'inject' },
        ],
      }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects static fieldMap entry without staticValue', () => {
    const result = CreateMappingSchema.safeParse(
      validPayload({ fieldMap: [{ source: 'static', target: { fieldId: 'f', schemaType: 'string' } }] }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes('staticValue'));
      expect(issue?.message).toContain('staticValue is required');
    }
  });

  it('rejects non-static fieldMap entry with staticValue set', () => {
    const result = CreateMappingSchema.safeParse(
      validPayload({
        fieldMap: [{ source: 'ticket.title', staticValue: 'oops', target: { fieldId: 'summary', schemaType: 'string' } }],
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes('staticValue'));
      expect(issue?.message).toContain('only be set when source is "static"');
    }
  });

  it('rejects fieldMap with more than 50 entries', () => {
    const bigMap = Array.from({ length: 51 }, (_, i) => ({
      source: 'ticket.title' as const,
      target: { fieldId: `field${i}`, schemaType: 'string' },
    }));
    expect(CreateMappingSchema.safeParse(validPayload({ fieldMap: bigMap })).success).toBe(false);
  });

  it('rejects statusMap entry missing both jiraStatusId and jiraStatusCategory', () => {
    const result = CreateMappingSchema.safeParse(
      validPayload({ statusMap: [{ opsninjaStatus: 'resolved' }] }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.message.includes('jiraStatusId') || i.message.includes('At least one'),
      );
      expect(issue).toBeDefined();
    }
  });

  it('rejects statusMap entry with unknown opsninjaStatus', () => {
    expect(
      CreateMappingSchema.safeParse(
        validPayload({ statusMap: [{ jiraStatusId: 'done', opsninjaStatus: 'not_an_opsninja_status' }] }),
      ).success,
    ).toBe(false);
  });

  it('rejects fieldMap entry where target.fieldId is empty', () => {
    const result = CreateMappingSchema.safeParse(
      validPayload({ fieldMap: [{ source: 'ticket.title', target: { fieldId: '', schemaType: 'string' } }] }),
    );
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// UpdateMappingSchema — partial patch semantics
// ---------------------------------------------------------------------------

describe('UpdateMappingSchema', () => {
  it('accepts empty patch (all fields optional)', () => {
    expect(UpdateMappingSchema.safeParse({}).success).toBe(true);
  });

  it('accepts patch with only projectKey', () => {
    expect(UpdateMappingSchema.safeParse({ projectKey: 'OPS' }).success).toBe(true);
  });

  it('accepts patch setting isDefault=true', () => {
    expect(UpdateMappingSchema.safeParse({ isDefault: true }).success).toBe(true);
  });

  it('accepts patch disabling the mapping', () => {
    expect(UpdateMappingSchema.safeParse({ enabled: false }).success).toBe(true);
  });

  it('rejects unknown field (strict mode)', () => {
    expect(UpdateMappingSchema.safeParse({ unknownField: 'bad' }).success).toBe(false);
  });

  it('rejects connectionId — connection reassignment not allowed via update', () => {
    // connectionId is omitted from UpdateMappingSchema for security
    expect(UpdateMappingSchema.safeParse({ connectionId: CONN_ID, projectKey: 'OPS' }).success).toBe(false);
  });

  it('validates fieldMap entries in a partial update', () => {
    const result = UpdateMappingSchema.safeParse({
      fieldMap: [{ source: 'ticket.internal_secret', target: { fieldId: 'f', schemaType: 'string' } }],
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ListMappingsQuerySchema — coercion and caps
// ---------------------------------------------------------------------------

describe('ListMappingsQuerySchema', () => {
  it('applies default limit=25 when not specified', () => {
    const r = ListMappingsQuerySchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.limit).toBe(25);
  });

  it('parses limit from string', () => {
    const r = ListMappingsQuerySchema.safeParse({ limit: '10' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.limit).toBe(10);
  });

  it('clamps limit to 100 when above cap', () => {
    const r = ListMappingsQuerySchema.safeParse({ limit: '9999' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.limit).toBe(100);
  });

  it('clamps limit to 1 when below minimum', () => {
    const r = ListMappingsQuerySchema.safeParse({ limit: '0' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.limit).toBe(1);
  });

  it('accepts valid UUID connectionId filter', () => {
    const r = ListMappingsQuerySchema.safeParse({ connectionId: CONN_ID });
    expect(r.success).toBe(true);
  });

  it('rejects non-UUID connectionId', () => {
    expect(ListMappingsQuerySchema.safeParse({ connectionId: 'bad-id' }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DiscoveryQuerySchema — refresh coercion
// ---------------------------------------------------------------------------

describe('DiscoveryQuerySchema', () => {
  it('coerces refresh="true" to boolean true', () => {
    const r = DiscoveryQuerySchema.safeParse({ refresh: 'true' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.refresh).toBe(true);
  });

  it('coerces refresh="false" to boolean false', () => {
    const r = DiscoveryQuerySchema.safeParse({ refresh: 'false' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.refresh).toBe(false);
  });

  it('applies default limit=50', () => {
    const r = DiscoveryQuerySchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.limit).toBe(50);
  });

  it('clamps discovery limit to 200', () => {
    const r = DiscoveryQuerySchema.safeParse({ limit: '9999' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.limit).toBe(200);
  });

  it('accepts issueTypeId filter', () => {
    const r = DiscoveryQuerySchema.safeParse({ issueTypeId: '10001' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.issueTypeId).toBe('10001');
  });
});
