import { z } from 'zod';

/** ISO-8601 timestamp with offset (data-model.md §6). */
export const IsoDateTime = z.iso.datetime({ offset: true });

/** Single trimmed line with a maximum length. */
export const line = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((s) => !/[\r\n]/.test(s), { message: 'must be a single line' });

export const ExternalId = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/);
export type ExternalId = z.infer<typeof ExternalId>;

export const Uuid = z.uuid();

/**
 * http(s) URL or app-relative path, ≤ 500 chars (data-model.md §13). A relative path must start with a single `/`:
 * `//host` and `/\host` are protocol-relative and would leave the app.
 */
export const DecisionLink = z
  .string()
  .trim()
  .max(500)
  .refine((s) => /^https?:\/\//.test(s) || /^\/(?![/\\])/.test(s), {
    message: 'must be an http(s) URL or an app-relative path',
  });

/** `?state=A,B` → ['A', 'B'] for `z.preprocess`; non-strings (already arrays) pass through. */
export const splitCsv = (v: unknown) =>
  typeof v === 'string'
    ? v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : v;

export const StageInput = z
  .object({
    index: z.number().int().min(1),
    count: z.number().int().min(1).max(20),
    name: line(60).nullable().optional(),
  })
  .refine((s) => s.index <= s.count, {
    message: 'stage.index must be ≤ stage.count',
    path: ['index'],
  });

/** RFC 9457-style error body; never carries stack traces, SQL or request bodies. */
export const Problem = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type Problem = z.infer<typeof Problem>;

export const PROBLEM_TYPES = {
  validation: 'urn:cdevi:problem:validation',
  unauthenticated: 'urn:cdevi:problem:unauthenticated',
  forbidden: 'urn:cdevi:problem:forbidden',
  notFound: 'urn:cdevi:problem:not-found',
  rateLimited: 'urn:cdevi:problem:rate-limited',
  invalidTransition: 'urn:cdevi:problem:invalid-transition',
  pendingRequestExists: 'urn:cdevi:problem:pending-request-exists',
  invalidCursor: 'urn:cdevi:problem:invalid-cursor',
  unknownStage: 'urn:cdevi:problem:unknown-stage',
  artifactImmutable: 'urn:cdevi:problem:artifact-immutable',
  alreadyResolved: 'urn:cdevi:problem:already-resolved',
  internal: 'urn:cdevi:problem:internal',
} as const;
