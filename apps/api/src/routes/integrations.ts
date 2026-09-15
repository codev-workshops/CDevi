import { JiraWebhookEvent, JiraWebhookResult } from '@cdevi/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { problems } from '../lib/problem';
import { applyJiraEvent, verifyJiraSignature } from '../services/jira-webhook';

export interface IntegrationRouteOptions {
  jiraWebhookSecret?: string | undefined;
}

const JIRA_WEBHOOK_BODY_LIMIT = 256 * 1024;
const JIRA_WEBHOOK_RATE_MAX = 120;

/**
 * Encapsulated: the raw-buffer JSON parser below applies only to routes in this plugin so the HMAC is
 * computed over the exact bytes Jira sent (FR-008; research R35).
 */
export default async function integrationRoutes(
  app: FastifyInstance,
  opts: IntegrationRouteOptions,
) {
  const secret = opts.jiraWebhookSecret;
  if (!secret)
    app.log.warn(
      'JIRA_WEBHOOK_SECRET is not set: POST /integrations/jira/webhook rejects every call',
    );

  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

  const r = app.withTypeProvider<ZodTypeProvider>();
  r.post(
    '/integrations/jira/webhook',
    {
      bodyLimit: JIRA_WEBHOOK_BODY_LIMIT,
      config: { rateLimit: { max: JIRA_WEBHOOK_RATE_MAX, timeWindow: '1 minute' } },
      schema: {
        tags: ['integrations'],
        security: [],
        response: { 202: JiraWebhookResult },
      },
    },
    async (request, reply) => {
      const raw = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
      const header = request.headers['x-hub-signature'];
      if (!verifyJiraSignature(raw, typeof header === 'string' ? header : undefined, secret))
        throw problems.unauthenticated('The webhook signature is missing or invalid.');

      let json: unknown;
      try {
        json = JSON.parse(raw.toString('utf8'));
      } catch {
        throw problems.validation([{ path: '', message: 'The body is not valid JSON.' }]);
      }
      const parsed = JiraWebhookEvent.safeParse(json);
      if (!parsed.success)
        throw problems.validation(
          parsed.error.issues.map((i) => ({ path: `/${i.path.join('/')}`, message: i.message })),
        );

      const t0 = performance.now();
      const result = await app.tx({}, (client) => applyJiraEvent(client, parsed.data, app.now()));
      reply.header('server-timing', `db;dur=${(performance.now() - t0).toFixed(1)}`);
      return reply.code(202).send(result);
    },
  );
}
