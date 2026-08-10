/**
 * Identity roles seed.
 *
 * Installs the six canonical roles, the full permission catalogue, and the
 * role_permissions matrix. Safe to run multiple times — all inserts use
 * ON CONFLICT DO NOTHING semantics so re-runs are no-ops.
 *
 * If a permission has been renamed, orphaned role_permissions rows that
 * reference the old permission code will remain until the old permission is
 * deleted (which requires a separate cleanup migration). This seed never
 * deletes rows.
 *
 * Usage:
 *   DATABASE_URL=postgres://user:pass@localhost:5432/opsninja \
 *     tsx seeds/identity-roles.seed.ts
 */
import postgres from 'postgres';
import { PERMISSIONS, ROLE_PERMISSIONS, type RoleName } from '@opsninja/shared';

const DATABASE_URL = process.env['DATABASE_URL'];
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

// ---------------------------------------------------------------------------
// Canonical role definitions — name MUST match ROLE_NAMES in shared/identity
// ---------------------------------------------------------------------------
const ROLES: Array<{ id: string; name: RoleName; displayName: string; description: string }> = [
  {
    id:          'a0000000-0000-0000-0000-000000000001',
    name:        'support_admin',
    displayName: 'Support Administrator',
    description: 'Full platform access including user management and all configuration.',
  },
  {
    id:          'a0000000-0000-0000-0000-000000000002',
    name:        'support_manager',
    displayName: 'Support Manager',
    description: 'Manages agents, org scopes, SLA policies and escalation routing.',
  },
  {
    id:          'a0000000-0000-0000-0000-000000000003',
    name:        'support_lead',
    displayName: 'Support Lead / Analyst',
    description: 'Senior agent with reporting access and category management.',
  },
  {
    id:          'a0000000-0000-0000-0000-000000000004',
    name:        'support_agent',
    displayName: 'Support Agent',
    description: 'Front-line agent; creates, updates and resolves tickets.',
  },
  {
    id:          'a0000000-0000-0000-0000-000000000005',
    name:        'integration_admin',
    displayName: 'Integration Administrator',
    description: 'Configures Jira OAuth credentials, field mappings and webhook routing.',
  },
  {
    id:          'a0000000-0000-0000-0000-000000000006',
    name:        'portal_user',
    displayName: 'Portal User',
    description: 'External customer; read-only access to own tickets and public comments.',
  },
];

async function seed(): Promise<void> {
  const sql = postgres(DATABASE_URL!, { max: 1 });

  try {
    console.log('[identity-seed] Seeding roles…');
    for (const role of ROLES) {
      await sql`
        INSERT INTO roles (id, name, display_name, description)
        VALUES (${role.id}::uuid, ${role.name}, ${role.displayName}, ${role.description})
        ON CONFLICT (name) DO NOTHING
      `;
    }
    console.log(`[identity-seed] ${ROLES.length} roles upserted.`);

    console.log('[identity-seed] Seeding permissions…');
    for (const code of PERMISSIONS) {
      await sql`
        INSERT INTO permissions (code)
        VALUES (${code})
        ON CONFLICT (code) DO NOTHING
      `;
    }
    console.log(`[identity-seed] ${PERMISSIONS.length} permissions upserted.`);

    console.log('[identity-seed] Seeding role_permissions matrix…');
    let wired = 0;
    for (const role of ROLES) {
      const permCodes = ROLE_PERMISSIONS[role.name];
      for (const code of permCodes) {
        await sql`
          INSERT INTO role_permissions (role_id, permission_id)
          SELECT r.id, p.id
          FROM   roles r
          JOIN   permissions p ON p.code = ${code}
          WHERE  r.name = ${role.name}
          ON CONFLICT (role_id, permission_id) DO NOTHING
        `;
        wired++;
      }
    }
    console.log(`[identity-seed] ${wired} role_permissions entries wired.`);

    console.log('[identity-seed] Done.');
  } finally {
    await sql.end();
  }
}

seed().catch((err: unknown) => {
  console.error('[identity-seed] Failed:', err);
  process.exit(1);
});
