import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { createIngestKey } from '../src/cli/ingest-key-create';
import { createUser } from '../src/cli/user-create';
import { hashToken } from '../src/token';
import { verifyPassword } from '../src/password';
import { parseArgs } from '../src/cli/args';

describe('cli arg parsing', () => {
  it('parses --key value and bare flags', () => {
    expect(parseArgs(['--email', 'a@b.c', '--password-stdin', '--projects', 'x,y'])).toEqual({
      email: 'a@b.c',
      'password-stdin': true,
      projects: 'x,y',
    });
  });
});

describe.skipIf(Boolean(process.env['CDEVI_SKIP_DB_TESTS']))('admin CLIs (FR-005, FR-021)', () => {
  const url = process.env['DATABASE_MIGRATOR_URL']!;
  const pool = new pg.Pool({ connectionString: url });
  afterAll(() => pool.end());

  it('creates a user with a scrypt hash and memberships', async () => {
    const email = `cli-${Date.now()}@cdevi.demo`;
    const id = await createUser(url, {
      email,
      displayName: 'CLI User',
      role: 'viewer',
      projectKeys: ['payments-api'],
      password: 'a-long-password',
    });
    const row = (await pool.query('select email, role, password_hash from users where id=$1', [id]))
      .rows[0];
    expect(row.email).toBe(email);
    expect(row.role).toBe('viewer');
    expect(await verifyPassword('a-long-password', row.password_hash)).toBe(true);
    expect(await verifyPassword('wrong-password', row.password_hash)).toBe(false);
    expect(
      Number(
        (await pool.query('select count(*) c from project_memberships where user_id=$1', [id]))
          .rows[0].c,
      ),
    ).toBe(1);
  });

  it('rejects invalid role, short password and unknown project', async () => {
    await expect(
      createUser(url, {
        email: 'x@y.z',
        displayName: 'X',
        role: 'root' as never,
        projectKeys: [],
        password: 'a-long-password',
      }),
    ).rejects.toThrow(/role/);
    await expect(
      createUser(url, {
        email: 'x@y.z',
        displayName: 'X',
        role: 'viewer',
        projectKeys: [],
        password: 'short',
      }),
    ).rejects.toThrow(/8 characters/);
    await expect(
      createUser(url, {
        email: `u-${Date.now()}@y.z`,
        displayName: 'X',
        role: 'viewer',
        projectKeys: ['nope'],
        password: 'a-long-password',
      }),
    ).rejects.toThrow(/unknown project/);
  });

  it('creates an ingestion key stored only as a SHA-256 hash', async () => {
    const { id, token } = await createIngestKey(url, 'cli-test', ['web-app']);
    const row = (
      await pool.query('select token_hash, project_ids from ingestion_principals where id=$1', [id])
    ).rows[0];
    expect(Buffer.from(row.token_hash).equals(hashToken(token))).toBe(true);
    expect(row.project_ids).toHaveLength(1);
    expect(token.startsWith('cdvi_')).toBe(true);
    await expect(createIngestKey(url, 'x', [])).rejects.toThrow(/at least one/);
  });
});
