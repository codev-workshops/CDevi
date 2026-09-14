import { createPool } from '@cdevi/db';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type pg from 'pg';

export interface TxContext {
  organizationId?: string | undefined;
  userId?: string | undefined;
  isolation?: 'READ COMMITTED' | 'REPEATABLE READ' | undefined;
}

declare module 'fastify' {
  interface FastifyInstance {
    pool: pg.Pool;
    /** Runs `fn` in one transaction, setting the RLS context variables (architecture §6). */
    tx<T>(ctx: TxContext, fn: (client: pg.PoolClient) => Promise<T>): Promise<T>;
  }
}

export interface DbPluginOptions {
  pool?: pg.Pool | undefined;
}

export default fp<DbPluginOptions>(async (app: FastifyInstance, opts) => {
  const pool = opts.pool ?? createPool();
  app.decorate('pool', pool);
  app.decorate('tx', async function tx<
    T,
  >(ctx: TxContext, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query(`BEGIN ISOLATION LEVEL ${ctx.isolation ?? 'READ COMMITTED'}`);
      if (ctx.organizationId)
        await client.query(`SELECT set_config('app.organization_id', $1, true)`, [
          ctx.organizationId,
        ]);
      if (ctx.userId)
        await client.query(`SELECT set_config('app.user_id', $1, true)`, [ctx.userId]);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  });
  app.addHook('onClose', async () => {
    if (!opts.pool) await pool.end();
  });
});
