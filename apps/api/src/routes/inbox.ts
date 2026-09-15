import { InboxQuery, InboxSnapshot, RecordParams, RecordView } from '@cdevi/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { problems } from '../lib/problem';
import type { InboxChange } from '../plugins/notify';
import { visibleProjects, type SessionUser } from '../services/auth';
import { inboxSnapshot, recordView, type Scope } from '../services/inbox-query';

export interface InboxRouteOptions {
  heartbeatMs?: number | undefined;
}

const sseFrame = (c: InboxChange) =>
  `id: ${c.seq}\nevent: inbox.changed\ndata: ${JSON.stringify({ projectId: c.projectId, workflowId: c.workflowId, requirementId: c.requirementId })}\n\n`;

export default async function inboxRoutes(app: FastifyInstance, opts: InboxRouteOptions) {
  const heartbeatMs = opts.heartbeatMs ?? 25_000;
  const open = new Set<() => void>();
  app.addHook('onClose', async () => {
    for (const end of open) end();
    open.clear();
  });

  const r = app.withTypeProvider<ZodTypeProvider>();

  /** Visible projects ∩ selector. `project` not visible → 404 (never confirms existence). */
  async function scopeFor(user: SessionUser, project: string): Promise<Scope> {
    const visible = (await visibleProjects(app.pool, user)).map((p) => p.id);
    if (project === 'all')
      return { organizationId: user.organizationId, projectIds: visible, project };
    if (!visible.includes(project))
      throw problems.notFound('That project is not available to you.');
    return { organizationId: user.organizationId, projectIds: [project], project };
  }

  r.get(
    '/inbox',
    {
      schema: { tags: ['inbox'], querystring: InboxQuery, response: { 200: InboxSnapshot } },
      preHandler: app.requireUser,
    },
    async (request: FastifyRequest, reply) => {
      const q = request.query as z.infer<typeof InboxQuery>;
      const user = request.user!;
      const total = performance.now();
      const scope = await scopeFor(user, q.project);
      const db = performance.now();
      const snapshot = await app.tx(
        { organizationId: user.organizationId, userId: user.id, isolation: 'REPEATABLE READ' },
        (client) => inboxSnapshot(client, scope, q.tab, q.cursor, app.now()),
      );
      const dbMs = (performance.now() - db).toFixed(1);
      reply.header(
        'server-timing',
        `db;dur=${dbMs}, total;dur=${(performance.now() - total).toFixed(1)}`,
      );
      request.log.info(
        {
          userId: user.id,
          tab: q.tab,
          project: q.project,
          items: snapshot.items.length,
          counts: snapshot.counts,
        },
        'inbox snapshot',
      );
      return snapshot;
    },
  );

  r.get(
    '/inbox/records/:kind/:id',
    {
      schema: { tags: ['inbox'], params: RecordParams, response: { 200: RecordView } },
      preHandler: app.requireUser,
    },
    async (request: FastifyRequest) => {
      const { kind, id } = request.params as z.infer<typeof RecordParams>;
      const user = request.user!;
      const scope = await scopeFor(user, 'all');
      const view = await app.tx(
        { organizationId: user.organizationId, userId: user.id },
        (client) => recordView(client, scope, kind, id, app.now()),
      );
      if (!view) throw problems.notFound("This item isn't available to you.");
      return view;
    },
  );

  app.get(
    '/inbox/stream',
    {
      schema: {
        tags: ['inbox'],
        headers: z.object({ 'last-event-id': z.string().optional() }).passthrough(),
      },
      preHandler: app.requireUser,
    },
    async (request, reply: FastifyReply) => {
      const user = request.user!;
      const visible = new Set((await visibleProjects(app.pool, user)).map((p) => p.id));

      reply.hijack();
      reply.raw.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        // no-transform: proxies (incl. the Next rewrite) must not gzip/buffer the stream
        'cache-control': 'no-store, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
        'x-content-type-options': 'nosniff',
      });
      reply.raw.write(': connected\n\n');

      // Replay events missed since Last-Event-ID (≤ 24 h are retained), once.
      const last = request.headers['last-event-id'];
      const lastSeq = last ? Number(last) : NaN;
      let replayedUpTo = 0;
      if (Number.isFinite(lastSeq) && lastSeq >= 0) {
        const r = await app.pool.query<{
          seq: string;
          project_id: string;
          workflow_id: string | null;
          requirement_id: string | null;
        }>(
          `SELECT seq, project_id, workflow_id, requirement_id FROM inbox_change_log WHERE organization_id = $1 AND seq > $2 ORDER BY seq LIMIT 1000`,
          [user.organizationId, lastSeq],
        );
        for (const row of r.rows) {
          const seq = Number(row.seq);
          replayedUpTo = seq;
          if (visible.has(row.project_id))
            reply.raw.write(
              sseFrame({
                seq,
                organizationId: user.organizationId,
                projectId: row.project_id,
                workflowId: row.workflow_id,
                requirementId: row.requirement_id,
              }),
            );
        }
        request.log.info({ userId: user.id, replayed: r.rowCount }, 'sse replay');
      }

      const off = app.notify.on((change) => {
        if (change.organizationId !== user.organizationId || !visible.has(change.projectId)) return;
        if (change.seq <= replayedUpTo) return; // already replayed
        reply.raw.write(sseFrame(change));
      });
      const heartbeat = setInterval(
        () => reply.raw.write(`: heartbeat ${Date.now()}\n\n`),
        heartbeatMs,
      );

      const cleanup = () => {
        clearInterval(heartbeat);
        off();
        open.delete(end);
        request.log.info({ userId: user.id }, 'sse disconnect');
      };
      const end = () => {
        cleanup();
        reply.raw.end();
      };
      open.add(end);
      request.raw.on('close', cleanup);
      // hijacked: the response is streamed manually and ends when the client disconnects or the app closes
    },
  );
}
