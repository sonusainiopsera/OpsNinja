/**
 * Partition provisioner – pre-creates monthly RANGE partitions for
 * tickets, comments and audit_logs before any seed insert executes.
 *
 * OpsNinja uses PARTITION BY RANGE (created_at) on these three tables.
 * Inserting a row whose created_at falls outside an existing partition
 * causes a PostgreSQL error at runtime, so the generator pre-creates
 * every partition in the generation window plus a catch-all "future" partition.
 *
 * This helper emits test-only SQL that is NEVER applied to the production
 * schema — it exists only in test fixture migrations.
 */

export function buildPartitionSql(
  parentTable: string,
  months: string[],
): string {
  const stmts: string[] = [];

  for (const month of months) {
    const [year, mon] = month.split('-').map(Number);
    const start = `${year}-${String(mon).padStart(2, '0')}-01`;
    const next = mon === 12
      ? `${year + 1}-01-01`
      : `${year}-${String(mon + 1).padStart(2, '0')}-01`;

    const partitionName = `${parentTable}_${month.replace('-', '_')}`;
    stmts.push(
      `CREATE TABLE IF NOT EXISTS ${partitionName}` +
      ` PARTITION OF ${parentTable}` +
      ` FOR VALUES FROM ('${start}') TO ('${next}');`,
    );
  }

  // Catch-all default partition for rows outside the explicit window.
  stmts.push(
    `CREATE TABLE IF NOT EXISTS ${parentTable}_default` +
    ` PARTITION OF ${parentTable} DEFAULT;`,
  );

  return stmts.join('\n');
}

/** Returns all partition SQL for the three partitioned tables. */
export function buildAllPartitionSql(months: string[]): string {
  return [
    buildPartitionSql('tickets', months),
    buildPartitionSql('comments', months),
    buildPartitionSql('audit_logs', months),
  ].join('\n\n');
}
