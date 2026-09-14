import { once } from 'node:events';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asIngest, iso, MIN, plus, signIn, skipDb, testApp, uniq } from './helpers';

interface SseEvent {
  id?: string;
  event?: string;
  data?: string;
}

function parseSse(chunk: string): SseEvent[] {
  return chunk
    .split('\n\n')
    .filter((b) => b.trim() && !b.startsWith(':'))
    .map((block) => {
      const ev: SseEvent = {};
      for (const line of block.split('\n')) {
        if (line.startsWith('id:')) ev.id = line.slice(3).trim();
        else if (line.startsWith('event:')) ev.event = line.slice(6).trim();
        else if (line.startsWith('data:')) ev.data = line.slice(5).trim();
      }
      return ev;
    });
}

/** Opens the SSE route over a real socket, returns a reader that resolves with events as they arrive. */
async function openStream(baseUrl: string, cookie: string, lastEventId?: string) {
  const headers: Record<string, string> = { cookie, accept: 'text/event-stream' };
  if (lastEventId) headers['last-event-id'] = lastEventId;
  const res = await fetch(`${baseUrl}/api/inbox/stream`, { headers });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events: SseEvent[] = [];
  const pump = (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const idx = buffer.lastIndexOf('\n\n');
      if (idx >= 0) {
        events.push(...parseSse(buffer.slice(0, idx + 2)));
        buffer = buffer.slice(idx + 2);
      }
    }
  })();
  return {
    res,
    events,
    waitFor: async (pred: (e: SseEvent) => boolean, timeoutMs = 5000) => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const hit = events.find(pred);
        if (hit) return hit;
        await new Promise((r) => setTimeout(r, 25));
      }
      throw new Error(
        `no matching SSE event within ${timeoutMs} ms; got ${JSON.stringify(events)}`,
      );
    },
    close: async () => {
      await reader.cancel().catch(() => {});
      await pump.catch(() => {});
    },
  };
}

describe.skipIf(skipDb)('GET /api/inbox/stream (FR-019, SC-007)', () => {
  let app: FastifyInstance;
  let baseUrl: string;
  beforeAll(async () => {
    app = await testApp();
    baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
  });
  afterAll(() => app.close());

  const ingestNew = async (ext: string, projectKey = 'payments-api') => {
    const r = await app.inject(
      asIngest({
        method: 'PUT',
        url: `/api/ingest/workflows/${ext}`,
        payload: {
          projectKey,
          title: 'Stream test',
          state: 'RUNNING',
          observedAt: iso(plus(-1 * MIN)),
        },
      }),
    );
    expect(r.statusCode).toBe(200);
    return r.json().id as string;
  };

  it('requires a session', async () => {
    const res = await fetch(`${baseUrl}/api/inbox/stream`);
    expect(res.status).toBe(401);
  });

  it('emits inbox.changed with id=seq within 1 s of an ingestion write to a visible project', async () => {
    const cookie = await signIn(app, 'admin@cdevi.demo');
    const s = await openStream(baseUrl, cookie);
    try {
      expect(s.res.headers.get('content-type')).toMatch(/text\/event-stream/);
      const ext = uniq('sse');
      const t = Date.now();
      const id = await ingestNew(ext);
      const ev = await s.waitFor(
        (e) => e.event === 'inbox.changed' && (e.data ?? '').includes(id),
        1000,
      );
      expect(Date.now() - t).toBeLessThan(1000);
      expect(Number(ev.id)).toBeGreaterThan(0);
      expect(JSON.parse(ev.data!)).toMatchObject({ workflowId: id });
    } finally {
      await s.close();
    }
  });

  it('does not emit for a project the user cannot see (SC-008)', async () => {
    const viewer = await signIn(app, 'viewer1@cdevi.demo');
    const me = (
      await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: viewer } })
    ).json();
    const visible = new Set(me.projects.map((p: { key: string }) => p.key));
    const hidden = ['payments-api', 'web-app', 'storefront', 'platform'].find(
      (k) => !visible.has(k),
    )!;
    const shown = [...visible][0] as string;
    const s = await openStream(baseUrl, viewer);
    try {
      const hiddenId = await ingestNew(uniq('hidden'), hidden);
      const shownId = await ingestNew(uniq('shown'), shown);
      await s.waitFor((e) => (e.data ?? '').includes(shownId), 2000);
      expect(s.events.some((e) => (e.data ?? '').includes(hiddenId))).toBe(false);
    } finally {
      await s.close();
    }
  });

  it('SC-007 reconnect with Last-Event-ID replays exactly the missed events once', async () => {
    const cookie = await signIn(app, 'admin@cdevi.demo');
    const first = await openStream(baseUrl, cookie);
    const a = await ingestNew(uniq('replay-a'));
    const evA = await first.waitFor((e) => (e.data ?? '').includes(a));
    await first.close();
    const b = await ingestNew(uniq('replay-b'));
    const c = await ingestNew(uniq('replay-c'));
    const second = await openStream(baseUrl, cookie, evA.id);
    try {
      await second.waitFor((e) => (e.data ?? '').includes(c), 2000);
      const replayed = second.events
        .filter((e) => e.event === 'inbox.changed')
        .map((e) => JSON.parse(e.data!).workflowId);
      expect(replayed.filter((id) => id === b)).toHaveLength(1);
      expect(replayed.filter((id) => id === c)).toHaveLength(1);
      expect(replayed).not.toContain(a);
    } finally {
      await second.close();
    }
  });

  it('50 concurrent clients all receive one event', async () => {
    const cookie = await signIn(app, 'admin@cdevi.demo');
    const streams = await Promise.all(
      Array.from({ length: 50 }, () => openStream(baseUrl, cookie)),
    );
    try {
      const id = await ingestNew(uniq('fanout'));
      await Promise.all(streams.map((s) => s.waitFor((e) => (e.data ?? '').includes(id), 5000)));
      for (const s of streams)
        expect(s.events.filter((e) => (e.data ?? '').includes(id))).toHaveLength(1);
    } finally {
      await Promise.all(streams.map((s) => s.close()));
    }
  });

  it('sends a heartbeat comment', async () => {
    const heartbeat = await testApp({ heartbeatMs: 50 });
    const url = await heartbeat.listen({ port: 0, host: '127.0.0.1' });
    try {
      const cookie = await signIn(heartbeat, 'admin@cdevi.demo');
      const res = await fetch(`${url}/api/inbox/stream`, { headers: { cookie } });
      const reader = res.body!.getReader();
      const { value } = await reader.read();
      let text = new TextDecoder().decode(value);
      if (!text.includes(':')) text += new TextDecoder().decode((await reader.read()).value);
      expect(text).toMatch(/^:/m);
      await reader.cancel();
    } finally {
      await heartbeat.close();
    }
    void once;
  });
});
