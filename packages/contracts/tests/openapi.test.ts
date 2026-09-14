import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { buildFullOpenApi, buildOpenApi, buildWorkflowDetailOpenApi } from '../src/openapi';

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

const US1_YAML = resolve(
  import.meta.dirname,
  '../../../specs/001-sdlc-control-plane-mvp/contracts/openapi.yaml',
);

describe('specs/001 US1 contracts/openapi.yaml snapshot', () => {
  it('FR-001 equals the fragment generated from the Zod schemas', () => {
    const committed = parse(readFileSync(US1_YAML, 'utf8'));
    expect(committed).toEqual(JSON.parse(JSON.stringify(buildWorkflowDetailOpenApi())));
  });

  it('FR-001 documents the Workflow Detail, action and ingestion routes the plan lists', () => {
    expect(Object.keys(buildWorkflowDetailOpenApi()['paths'] as object)).toEqual([
      '/workflows/{id}',
      '/workflows/{id}/actions',
      '/ingest/workflows/{externalId}/stages/{position}',
      '/ingest/agent-runs/{externalId}',
      '/ingest/artifacts/{externalId}',
      '/ingest/test-runs/{externalId}',
      '/approvals',
      '/approvals/{id}',
      '/approvals/{id}/approve',
      '/approvals/{id}/reject',
      '/clarifications/{id}/answer',
    ]);
  });

  it('FR-011 FR-015 registers the Approval Center and decision schemas', () => {
    const doc = buildWorkflowDetailOpenApi() as {
      components: { schemas: Record<string, unknown> };
    };
    for (const name of [
      'ApprovalCenterSnapshot',
      'ApprovalCenterDetail',
      'ApproveRequest',
      'RejectRequest',
      'AnswerRequest',
      'DecisionResult',
      'AlreadyResolvedProblem',
    ]) {
      expect(doc.components.schemas).toHaveProperty(name);
    }
    const approve = (
      doc as unknown as { paths: Record<string, Record<string, { responses: object }>> }
    ).paths['/approvals/{id}/approve']!['post']!;
    expect(Object.keys(approve.responses)).toEqual(['200', '400', '401', '403', '404', '409']);
  });

  it('FR-001 the merged document keeps every 003 route and adds the US1 ones', () => {
    const paths = Object.keys(buildFullOpenApi()['paths'] as object);
    for (const p of Object.keys(buildOpenApi()['paths'] as object)) expect(paths).toContain(p);
    expect(paths).toContain('/workflows/{id}');
  });
});
