import { canCreateRequirement, type Me, type Role } from '@cdevi/contracts';
import { generateToken, hashToken, verifyPassword } from '@cdevi/db';
import type pg from 'pg';

export const SESSION_COOKIE = 'cdevi_session';
export const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000;
const LAST_SEEN_THROTTLE_MS = 60 * 1000;

export interface SessionUser {
  id: string;
  organizationId: string;
  displayName: string;
  role: Role;
}

/** Verifies credentials with the same timing whether or not the email exists. Returns the user or null. */
export async function authenticate(
  pool: pg.Pool,
  email: string,
  password: string,
): Promise<SessionUser | null> {
  const r = await pool.query<{
    id: string;
    organization_id: string;
    display_name: string;
    role: Role;
    password_hash: string;
    disabled_at: Date | null;
  }>(
    `SELECT id, organization_id, display_name, role, password_hash, disabled_at FROM users WHERE email = $1 LIMIT 1`,
    [email.toLowerCase()],
  );
  const user = r.rows[0];
  // Always run one scrypt verification so unknown emails are not distinguishable by latency.
  const ok = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok || user.disabled_at) return null;
  return {
    id: user.id,
    organizationId: user.organization_id,
    displayName: user.display_name,
    role: user.role,
  };
}
// A valid-format hash of a random password; verification against it always fails.
const DUMMY_HASH =
  'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

export async function createSession(pool: pg.Pool, user: SessionUser, now: Date): Promise<string> {
  const id = generateToken();
  await pool.query(
    `INSERT INTO sessions (id_hash, user_id, organization_id, created_at, last_seen_at) VALUES ($1,$2,$3,$4,$4)`,
    [hashToken(id), user.id, user.organizationId, now],
  );
  return id;
}

export async function revokeSession(pool: pg.Pool, id: string, now: Date): Promise<void> {
  await pool.query(
    `UPDATE sessions SET revoked_at = $2 WHERE id_hash = $1 AND revoked_at IS NULL`,
    [hashToken(id), now],
  );
}

/** Resolves a cookie value to its user, enforcing idle/absolute expiry and revocation. */
export async function resolveSession(
  pool: pg.Pool,
  id: string,
  now: Date,
): Promise<SessionUser | null> {
  const r = await pool.query<{
    user_id: string;
    organization_id: string;
    display_name: string;
    role: Role;
    created_at: Date;
    last_seen_at: Date;
    revoked_at: Date | null;
    disabled_at: Date | null;
  }>(
    `SELECT s.user_id, s.organization_id, s.created_at, s.last_seen_at, s.revoked_at, u.display_name, u.role, u.disabled_at
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = $1`,
    [hashToken(id)],
  );
  const s = r.rows[0];
  if (!s || s.revoked_at || s.disabled_at) return null;
  const t = now.getTime();
  if (t - s.last_seen_at.getTime() > SESSION_IDLE_MS) return null;
  if (t - s.created_at.getTime() > SESSION_ABSOLUTE_MS) return null;
  if (t - s.last_seen_at.getTime() > LAST_SEEN_THROTTLE_MS) {
    await pool.query(`UPDATE sessions SET last_seen_at = $2 WHERE id_hash = $1`, [
      hashToken(id),
      now,
    ]);
  }
  return {
    id: s.user_id,
    organizationId: s.organization_id,
    displayName: s.display_name,
    role: s.role,
  };
}

export interface VisibleProject {
  id: string;
  key: string;
  name: string;
}

/** Administrators see every project of the organization; others only their memberships (research R3). */
export async function visibleProjects(
  client: pg.Pool | pg.PoolClient,
  user: SessionUser,
): Promise<VisibleProject[]> {
  const r =
    user.role === 'administrator'
      ? await client.query<VisibleProject>(
          `SELECT id, key, name FROM projects WHERE organization_id = $1 ORDER BY key`,
          [user.organizationId],
        )
      : await client.query<VisibleProject>(
          `SELECT p.id, p.key, p.name FROM projects p JOIN project_memberships m ON m.project_id = p.id
            WHERE p.organization_id = $1 AND m.user_id = $2 ORDER BY p.key`,
          [user.organizationId, user.id],
        );
  return r.rows;
}

export async function buildMe(pool: pg.Pool, user: SessionUser): Promise<Me> {
  const org = (
    await pool.query<{ id: string; name: string; is_demo: boolean }>(
      `SELECT id, name, is_demo FROM organizations WHERE id = $1`,
      [user.organizationId],
    )
  ).rows[0]!;
  return {
    user: { id: user.id, displayName: user.displayName, role: user.role },
    organization: { id: org.id, name: org.name, isDemo: org.is_demo },
    projects: await visibleProjects(pool, user),
    canCreateRequirement: canCreateRequirement(user.role),
  };
}

export interface IngestionPrincipal {
  id: string;
  organizationId: string;
  name: string;
  projectIds: string[];
}

export async function resolvePrincipal(
  pool: pg.Pool,
  token: string,
): Promise<IngestionPrincipal | null> {
  const r = await pool.query<{
    id: string;
    organization_id: string;
    name: string;
    project_ids: string[];
    disabled_at: Date | null;
  }>(
    `SELECT id, organization_id, name, project_ids, disabled_at FROM ingestion_principals WHERE token_hash = $1`,
    [hashToken(token)],
  );
  const p = r.rows[0];
  if (!p || p.disabled_at) return null;
  return { id: p.id, organizationId: p.organization_id, name: p.name, projectIds: p.project_ids };
}
