import { EventEmitter } from 'node:events';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import pg from 'pg';

export interface InboxChange {
  seq: number;
  organizationId: string;
  projectId: string;
  workflowId: string;
}

export interface Notifier {
  readonly connected: boolean;
  on(listener: (change: InboxChange) => void): () => void;
}

declare module 'fastify' {
  interface FastifyInstance {
    notify: Notifier;
  }
}

export interface NotifyPluginOptions {
  connectionString?: string | undefined;
  /** Disable the LISTEN client (unit tests without a stream). */
  enabled?: boolean | undefined;
}

const CHANGE_LOG_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * One dedicated connection in `LISTEN inbox_changed` per process (research R6). Fans out to SSE handlers via an
 * in-process emitter. Reconnects with capped back-off; prunes inbox_change_log older than 24 h hourly.
 */
export default fp<NotifyPluginOptions>(async (app: FastifyInstance, opts) => {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);
  let client: pg.Client | null = null;
  let connected = false;
  let closed = false;
  let backoff = 1000;
  let reconnectTimer: NodeJS.Timeout | null = null;

  const connect = async () => {
    if (closed || opts.enabled === false) return;
    const c = new pg.Client({
      connectionString: opts.connectionString ?? process.env['DATABASE_URL'],
    });
    try {
      await c.connect();
      await c.query('LISTEN inbox_changed');
      client = c;
      connected = true;
      backoff = 1000;
      app.log.info('LISTEN inbox_changed connected');
      c.on('notification', (msg) => {
        if (msg.channel !== 'inbox_changed' || !msg.payload) return;
        try {
          const p = JSON.parse(msg.payload) as {
            seq: number | string;
            organizationId: string;
            projectId: string;
            workflowId: string;
          };
          emitter.emit('change', {
            seq: Number(p.seq),
            organizationId: p.organizationId,
            projectId: p.projectId,
            workflowId: p.workflowId,
          } satisfies InboxChange);
        } catch (e) {
          app.log.warn({ err: e }, 'bad inbox_changed payload');
        }
      });
      c.on('error', (e) => {
        app.log.warn({ err: e }, 'LISTEN connection error');
        scheduleReconnect();
      });
      c.on('end', () => {
        connected = false;
        scheduleReconnect();
      });
    } catch (e) {
      app.log.warn({ err: e }, 'LISTEN connect failed');
      scheduleReconnect();
    }
  };

  const scheduleReconnect = () => {
    connected = false;
    if (closed || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, backoff);
    backoff = Math.min(backoff * 2, 30_000);
  };

  const prune = async () => {
    try {
      await app.pool.query(
        `DELETE FROM inbox_change_log WHERE occurred_at < now() - ($1::int * interval '1 millisecond')`,
        [CHANGE_LOG_RETENTION_MS],
      );
    } catch (e) {
      app.log.warn({ err: e }, 'inbox_change_log prune failed');
    }
  };

  app.decorate('notify', {
    get connected() {
      return connected;
    },
    on(listener: (change: InboxChange) => void) {
      emitter.on('change', listener);
      return () => emitter.off('change', listener);
    },
  } satisfies Notifier);

  await connect();
  let pruneTimer: NodeJS.Timeout | null = null;
  if (opts.enabled !== false) {
    await prune();
    pruneTimer = setInterval(() => void prune(), 60 * 60 * 1000);
    pruneTimer.unref();
  }

  app.addHook('onClose', async () => {
    closed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (pruneTimer) clearInterval(pruneTimer);
    emitter.removeAllListeners();
    if (client) await client.end().catch(() => {});
  });
});
