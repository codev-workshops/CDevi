import { resolve } from 'node:path';
import pg from 'pg';
import { generateToken, hashToken } from '../token';
import { parseArgs } from './args';

/** Creates an ingestion principal scoped to the given project keys; returns the token (shown once). */
export async function createIngestKey(
  connectionString: string,
  name: string,
  projectKeys: string[],
): Promise<{ id: string; token: string }> {
  if (projectKeys.length === 0)
    throw new Error('at least one project key is required (scope is never "all")');
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const org = (await client.query<{ id: string }>('SELECT id FROM organizations LIMIT 1'))
      .rows[0];
    if (!org) throw new Error('no organization exists');
    const ids: string[] = [];
    for (const key of projectKeys) {
      const p = (
        await client.query<{ id: string }>(
          `SELECT id FROM projects WHERE organization_id=$1 AND key=$2`,
          [org.id, key],
        )
      ).rows[0];
      if (!p) throw new Error(`unknown project key ${key}`);
      ids.push(p.id);
    }
    const token = generateToken('cdvi_');
    const r = await client.query<{ id: string }>(
      `INSERT INTO ingestion_principals (organization_id, name, token_hash, project_ids) VALUES ($1,$2,$3,$4) RETURNING id`,
      [org.id, name, hashToken(token), ids],
    );
    return { id: r.rows[0]!.id, token };
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  const a = parseArgs(process.argv.slice(2));
  if (!a['name'] || !a['projects']) {
    console.error('usage: ingest-key:create --name orchestrator --projects key,key');
    process.exit(1);
  }
  createIngestKey(
    process.env['DATABASE_MIGRATOR_URL'] ?? '',
    String(a['name']),
    String(a['projects']).split(',').filter(Boolean),
  )
    .then((r) => {
      console.log(`created ingestion principal ${r.id}`);
      console.log(`token (shown once): ${r.token}`);
    })
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
