import { PROBLEM_TYPES, type Problem } from '@cdevi/contracts';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';

/** Thrown by services/routes; rendered as `application/problem+json`. Never carries internals. */
export class ProblemError extends Error {
  constructor(
    public readonly status: number,
    public readonly type: string,
    public readonly title: string,
    public readonly detail?: string,
    public readonly errors?: Problem['errors'],
  ) {
    super(detail ?? title);
    this.name = 'ProblemError';
  }
}

export const problems = {
  unauthenticated: (detail = 'Sign in to continue.') =>
    new ProblemError(401, PROBLEM_TYPES.unauthenticated, 'Not signed in', detail),
  forbidden: (detail = 'You do not have access to this resource.') =>
    new ProblemError(403, PROBLEM_TYPES.forbidden, 'Forbidden', detail),
  notFound: (detail = 'Not found.') =>
    new ProblemError(404, PROBLEM_TYPES.notFound, 'Not found', detail),
  invalidTransition: (detail: string) =>
    new ProblemError(409, PROBLEM_TYPES.invalidTransition, 'Invalid transition', detail),
  pendingRequestExists: (detail: string) =>
    new ProblemError(
      409,
      PROBLEM_TYPES.pendingRequestExists,
      'A request is already pending',
      detail,
    ),
  unknownStage: (detail: string) =>
    new ProblemError(404, PROBLEM_TYPES.unknownStage, 'Unknown stage', detail),
  artifactImmutable: (detail = 'This artifact is immutable: its producing stage has completed.') =>
    new ProblemError(409, PROBLEM_TYPES.artifactImmutable, 'Artifact is immutable', detail),
  invalidCursor: () =>
    new ProblemError(
      400,
      PROBLEM_TYPES.invalidCursor,
      'Invalid cursor',
      'The cursor does not match this tab.',
    ),
  validation: (errors: Problem['errors']) =>
    new ProblemError(
      400,
      PROBLEM_TYPES.validation,
      'Invalid request',
      'The request body or query is invalid.',
      errors,
    ),
};

export function sendProblem(reply: FastifyReply, p: ProblemError): FastifyReply {
  const body: Problem = { type: p.type, title: p.title, status: p.status };
  if (p.detail) body.detail = p.detail;
  if (p.errors) body.errors = p.errors;
  return reply.code(p.status).type('application/problem+json').send(body);
}

/** Fastify error handler: known problems pass through; everything else is a generic 500 with the reqId only. */
export function errorHandler(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  if (error instanceof ProblemError) return sendProblem(reply, error);
  if (hasZodFastifySchemaValidationErrors(error)) {
    return sendProblem(
      reply,
      problems.validation(
        error.validation.map((v) => ({
          path: String(
            (v.params as { issue?: { path?: unknown[] } }).issue?.path?.join('.') ??
              v.instancePath ??
              '',
          ),
          message: v.message ?? 'invalid',
        })),
      ),
    );
  }
  const fe = error as FastifyError;
  if (fe.statusCode === 429) {
    return sendProblem(
      reply,
      new ProblemError(
        429,
        PROBLEM_TYPES.rateLimited,
        'Too many attempts',
        'Try again in a minute.',
      ),
    );
  }
  if (fe.statusCode && fe.statusCode >= 400 && fe.statusCode < 500) {
    return sendProblem(
      reply,
      new ProblemError(
        fe.statusCode,
        PROBLEM_TYPES.validation,
        'Invalid request',
        'The request could not be processed.',
      ),
    );
  }
  request.log.error({ err: error, reqId: request.id }, 'unhandled error');
  return sendProblem(
    reply,
    new ProblemError(
      500,
      PROBLEM_TYPES.internal,
      'Something went wrong',
      `Request ${request.id} failed. Try again.`,
    ),
  );
}
