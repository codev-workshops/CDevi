import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { buildOpenApi } from '../src/openapi';

const YAML = resolve(import.meta.dirname, '../../../specs/003-inbox-home/contracts/openapi.yaml');

describe('contracts/openapi.yaml snapshot', () => {
  it('equals the document generated from the Zod schemas (run `pnpm -F @cdevi/contracts openapi` to refresh)', () => {
    const committed = parse(readFileSync(YAML, 'utf8'));
    expect(committed).toEqual(JSON.parse(JSON.stringify(buildOpenApi())));
  });

  it('documents every route the plan lists', () => {
    const paths = Object.keys(buildOpenApi()['paths'] as object);
    expect(paths).toEqual([
      '/auth/sign-in',
      '/auth/sign-out',
      '/auth/me',
      '/inbox',
      '/inbox/stream',
      '/inbox/records/{kind}/{id}',
      '/ingest/workflows/{externalId}',
      '/ingest/workflows/{externalId}/transitions',
      '/ingest/approvals/{externalId}',
      '/ingest/clarifications/{externalId}',
      '/healthz',
    ]);
  });
});
