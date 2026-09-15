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

type Operation = {
  tags: string[];
  security?: Array<Record<string, string[]>>;
  parameters?: Array<{
    name: string;
    in: string;
    required?: boolean;
    schema: Record<string, unknown>;
  }>;
  requestBody?: { content: Record<string, { schema: Record<string, unknown> }> };
  responses: Record<
    string,
    { headers?: Record<string, unknown>; content?: Record<string, unknown> }
  >;
};
type Doc = {
  info: { title: string };
  tags: Array<{ name: string }>;
  components: { schemas: Record<string, unknown> };
  paths: Record<string, Record<string, Operation>>;
};
const us1 = () => buildWorkflowDetailOpenApi() as unknown as Doc;
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

describe('specs/001 US1–US4 contracts/openapi.yaml snapshot', () => {
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
      '/dashboard',
      '/workflows',
      '/requirements',
      '/requirements/{id}',
      '/requirements/{id}/submit',
      '/requirements/{id}/approve',
      '/requirements/{id}/reject',
      '/ingest/requirements/{externalId}/analysis',
      '/integrations/jira/webhook',
    ]);
  });

  it('FR-007 FR-025 documents GET /requirements with project (default all), state, assignee and cursor and returns RequirementListPage', () => {
    const doc = us1();
    expect(doc.info.title).toBe(
      'CDevi API — Workflow Detail, Approval Center, Dashboard and Requirements (specs/001 US1–US4)',
    );
    expect(doc.tags.map((t) => t.name)).toEqual(
      expect.arrayContaining(['requirements', 'integrations', 'workflows']),
    );
    const get = doc.paths['/requirements']!['get']!;
    expect(get.tags).toEqual(['requirements']);
    expect(get.security).toEqual([{ sessionCookie: [] }]);
    const names = get.parameters!.map((p) => p.name);
    expect(names).toEqual(['project', 'state', 'assignee', 'cursor']);
    for (const p of get.parameters!) expect(p.in).toBe('query');
    expect(get.parameters!.find((p) => p.name === 'project')!.schema['default']).toBe('all');
    expect(Object.keys(get.responses)).toEqual(['200', '400', '401']);
    expect(get.responses['200']).toMatchObject({
      content: { 'application/json': { schema: ref('RequirementListPage') } },
    });
  });

  it('FR-007 FR-032 documents POST /requirements with CreateRequirementRequest → 201 RequirementDetail + Location and 400/401/403/404 problems', () => {
    const post = us1().paths['/requirements']!['post']!;
    expect(post.tags).toEqual(['requirements']);
    expect(post.requestBody).toMatchObject({
      content: { 'application/json': { schema: ref('CreateRequirementRequest') } },
    });
    expect(Object.keys(post.responses)).toEqual(['201', '400', '401', '403', '404']);
    expect(post.responses['201']).toMatchObject({
      headers: { Location: { schema: { type: 'string' } } },
      content: { 'application/json': { schema: ref('RequirementDetail') } },
    });
    for (const code of ['400', '401', '403', '404'])
      expect(post.responses[code]).toMatchObject({
        content: { 'application/problem+json': { schema: ref('Problem') } },
      });
  });

  it('FR-009 FR-010 FR-032 documents GET /requirements/{id} and the submit/approve/reject actions with 409 invalid-transition', () => {
    const doc = us1();
    const get = doc.paths['/requirements/{id}']!['get']!;
    expect(get.parameters).toEqual([
      expect.objectContaining({ name: 'id', in: 'path', required: true }),
    ]);
    expect(Object.keys(get.responses)).toEqual(['200', '401', '404']);
    expect(get.responses['200']).toMatchObject({
      content: { 'application/json': { schema: ref('RequirementDetail') } },
    });

    const submit = doc.paths['/requirements/{id}/submit']!['post']!;
    expect(submit.requestBody).toBeUndefined();
    expect(Object.keys(submit.responses)).toEqual(['200', '401', '403', '404', '409']);
    expect(submit.responses['200']).toMatchObject({
      content: { 'application/json': { schema: ref('RequirementDetail') } },
    });

    const approve = doc.paths['/requirements/{id}/approve']!['post']!;
    expect(approve.requestBody).toBeUndefined();
    expect(Object.keys(approve.responses)).toEqual(['200', '401', '403', '404', '409']);

    const reject = doc.paths['/requirements/{id}/reject']!['post']!;
    expect(reject.requestBody).toMatchObject({
      content: { 'application/json': { schema: ref('RejectRequirementRequest') } },
    });
    expect(Object.keys(reject.responses)).toEqual(['200', '400', '401', '403', '404', '409']);
    for (const op of [submit, approve, reject]) {
      expect(op.tags).toEqual(['requirements']);
      expect(op.security).toEqual([{ sessionCookie: [] }]);
      expect(op.responses['409']).toMatchObject({
        content: { 'application/problem+json': { schema: ref('Problem') } },
      });
    }
  });

  it('FR-036 documents PUT /ingest/requirements/{externalId}/analysis with the bearer ingestion token, RequirementAnalysisIngest → RequirementIngestResult and 400/401/403/404/409', () => {
    const put = us1().paths['/ingest/requirements/{externalId}/analysis']!['put']!;
    expect(put.tags).toEqual(['ingest']);
    expect(put.security).toEqual([{ ingestionToken: [] }]);
    expect(put.parameters).toEqual([
      expect.objectContaining({ name: 'externalId', in: 'path', required: true }),
    ]);
    expect(put.requestBody).toMatchObject({
      content: { 'application/json': { schema: ref('RequirementAnalysisIngest') } },
    });
    expect(Object.keys(put.responses)).toEqual(['200', '400', '401', '403', '404', '409']);
    expect(put.responses['200']).toMatchObject({
      content: { 'application/json': { schema: ref('RequirementIngestResult') } },
    });
  });

  it('FR-008 documents POST /integrations/jira/webhook with the x-hub-signature header, JiraWebhookEvent → 202 JiraWebhookResult and 400/401/413/429, no session security', () => {
    const post = us1().paths['/integrations/jira/webhook']!['post']!;
    expect(post.tags).toEqual(['integrations']);
    expect(post.security).toEqual([]);
    const sig = post.parameters!.find((p) => p.name === 'x-hub-signature')!;
    expect(sig).toMatchObject({ in: 'header', required: true });
    expect(sig.schema).toMatchObject({ type: 'string', pattern: '^sha256=[0-9a-f]{64}$' });
    expect(post.requestBody).toMatchObject({
      content: { 'application/json': { schema: ref('JiraWebhookEvent') } },
    });
    expect(Object.keys(post.responses)).toEqual(['202', '400', '401', '413', '429']);
    expect(post.responses['202']).toMatchObject({
      content: { 'application/json': { schema: ref('JiraWebhookResult') } },
    });
    for (const code of ['400', '401', '413', '429'])
      expect(post.responses[code]).toMatchObject({
        content: { 'application/problem+json': { schema: ref('Problem') } },
      });
  });

  it('FR-003 documents GET /workflows with project (default all), requirement, state, stage and cursor and returns WorkflowListPage', () => {
    const get = us1().paths['/workflows']!['get']!;
    expect(get.tags).toEqual(['workflows']);
    expect(get.security).toEqual([{ sessionCookie: [] }]);
    expect(get.parameters!.map((p) => p.name)).toEqual([
      'project',
      'requirement',
      'state',
      'stage',
      'cursor',
    ]);
    for (const p of get.parameters!) expect(p.in).toBe('query');
    expect(get.parameters!.find((p) => p.name === 'project')!.schema['default']).toBe('all');
    expect(Object.keys(get.responses)).toEqual(['200', '400', '401']);
    expect(get.responses['200']).toMatchObject({
      content: { 'application/json': { schema: ref('WorkflowListPage') } },
    });
  });

  it('FR-007 FR-008 FR-009 registers every US4 component schema', () => {
    const doc = us1();
    for (const name of [
      'RequirementState',
      'Requirement',
      'RequirementDetail',
      'RequirementListQuery',
      'RequirementListPage',
      'CreateRequirementRequest',
      'RejectRequirementRequest',
      'RequirementAnalysisIngest',
      'RequirementIngestResult',
      'JiraWebhookEvent',
      'JiraWebhookResult',
      'WorkflowListQuery',
      'WorkflowListItem',
      'WorkflowListPage',
    ])
      expect(doc.components.schemas).toHaveProperty(name);
  });

  it('FR-023 FR-025 documents GET /dashboard with project (default all) and window (24h|7d|30d, default 7d) and registers DashboardSnapshot and DashboardQuery', () => {
    const doc = buildWorkflowDetailOpenApi() as {
      info: { title: string };
      tags: Array<{ name: string }>;
      components: { schemas: Record<string, unknown> };
      paths: Record<
        string,
        Record<
          string,
          {
            tags: string[];
            parameters: Array<{ name: string; in: string; schema: Record<string, unknown> }>;
            responses: Record<string, unknown>;
          }
        >
      >;
    };
    expect(doc.tags.map((t) => t.name)).toContain('dashboard');
    const get = doc.paths['/dashboard']!['get']!;
    expect(get.tags).toEqual(['dashboard']);
    const project = get.parameters.find((p) => p.name === 'project')!;
    expect(project.in).toBe('query');
    expect(project.schema['default']).toBe('all');
    const window = get.parameters.find((p) => p.name === 'window')!;
    expect(window.in).toBe('query');
    expect(window.schema).toMatchObject({ enum: ['24h', '7d', '30d'], default: '7d' });
    expect(Object.keys(get.responses)).toEqual(['200', '400', '401']);
    expect(get.responses['200']).toMatchObject({
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/DashboardSnapshot' } },
      },
    });
    expect(doc.components.schemas).toHaveProperty('DashboardSnapshot');
    expect(doc.components.schemas).toHaveProperty('DashboardQuery');
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

  it('FR-001 the merged document keeps every 003 route and adds the US1–US4 ones', () => {
    const full = buildFullOpenApi() as {
      paths: object;
      tags: Array<{ name: string }>;
      components: { schemas: Record<string, unknown> };
    };
    const paths = Object.keys(full.paths);
    for (const p of Object.keys(buildOpenApi()['paths'] as object)) expect(paths).toContain(p);
    for (const p of Object.keys(buildWorkflowDetailOpenApi()['paths'] as object))
      expect(paths).toContain(p);
    expect(paths).toContain('/workflows/{id}');
    expect(paths).toContain('/approvals');
    expect(paths).toContain('/dashboard');
    expect(paths).toContain('/requirements');
    expect(paths).toContain('/integrations/jira/webhook');
    expect(paths).toContain('/workflows');
    expect(full.tags.map((t) => t.name)).toContain('dashboard');
    expect(full.tags.map((t) => t.name)).toContain('requirements');
    expect(full.components.schemas).toHaveProperty('DashboardSnapshot');
    expect(full.components.schemas).toHaveProperty('RequirementDetail');
  });
});
