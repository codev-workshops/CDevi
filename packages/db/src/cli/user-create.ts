import { resolve } from 'node:path';
import pg from 'pg';
import { ROLES, type Role } from '@cdevi/contracts';
import { hashPassword } from '../password';
import { parseArgs, readStdin } from './args';

export interface CreateUserInput {
  email: string;
  displayName: string;
  role: Role;
  projectKeys: string[];
  password: string;
}

/** Creates a user (and memberships) in the single organization. Returns the user id. */
export async function createUser(
  connectionString: string,
  input: CreateUserInput,
): Promise<string> {
  if (!ROLES.includes(input.role)) throw new Error(`role must be one of ${ROLES.join(', ')}`);
  if (input.password.length < 8) throw new Error('password must be at least 8 characters');
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('BEGIN');
    const org = (await client.query<{ id: string }>('SELECT id FROM organizations LIMIT 1'))
      .rows[0];
    if (!org) throw new Error('no organization exists — run the seed or create one first');
    const user = (
      await client.query<{ id: string }>(
        `INSERT INTO users (organization_id, email, display_name, password_hash, role) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [
          org.id,
          input.email.toLowerCase(),
          input.displayName,
          await hashPassword(input.password),
          input.role,
        ],
      )
    ).rows[0]!;
    for (const key of input.projectKeys) {
      const p = (
        await client.query<{ id: string }>(
          `SELECT id FROM projects WHERE organization_id=$1 AND key=$2`,
          [org.id, key],
        )
      ).rows[0];
      if (!p) throw new Error(`unknown project key ${key}`);
      await client.query(
        `INSERT INTO project_memberships (user_id, project_id, organization_id) VALUES ($1,$2,$3)`,
        [user.id, p.id, org.id],
      );
    }
    await client.query('COMMIT');
    return user.id;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  const a = parseArgs(process.argv.slice(2));
  (async () => {
    const password = a['password-stdin'] ? await readStdin() : undefined;
    if (!a['email'] || !a['name'] || !a['role'] || !password)
      throw new Error(
        'usage: user:create --email x --name "Name" --role viewer [--projects key,key] --password-stdin < pw.txt',
      );
    const id = await createUser(process.env['DATABASE_MIGRATOR_URL'] ?? '', {
      email: String(a['email']),
      displayName: String(a['name']),
      role: String(a['role']) as Role,
      projectKeys: a['projects'] ? String(a['projects']).split(',').filter(Boolean) : [],
      password,
    });
    console.log(`created user ${id}`);
  })().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
