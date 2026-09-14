import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

export * as schema from './schema';
export { migrate } from './migrate';
export { hashPassword, verifyPassword, isPasswordHash } from './password';
export { hashToken, generateToken } from './token';

export interface PoolOptions {
  connectionString?: string | undefined;
  /** Per-statement timeout in ms (Constitution IV: every remote call has a timeout). */
  statementTimeoutMs?: number | undefined;
  max?: number | undefined;
}

/** Pool for the application role with timeouts set on every connection. */
export function createPool(opts: PoolOptions = {}): pg.Pool {
  const connectionString = opts.connectionString ?? process.env['DATABASE_URL'];
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const statementTimeoutMs = opts.statementTimeoutMs ?? 5_000;
  return new pg.Pool({
    connectionString,
    max: opts.max ?? 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: statementTimeoutMs,
    idle_in_transaction_session_timeout: 15_000,
    query_timeout: statementTimeoutMs + 1_000,
  });
}

export function createDb(pool: pg.Pool) {
  return drizzle(pool, { schema });
}
export type Db = ReturnType<typeof createDb>;
