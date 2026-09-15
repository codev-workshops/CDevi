import { describe, expect, it } from 'vitest';
import {
  adfToPlainText,
  canTransitionRequirement,
  decodeRequirementCursor,
  decodeWorkflowCursor,
  encodeRequirementCursor,
  encodeWorkflowCursor,
  isSafeExternalUrl,
  isTerminalRequirement,
  mapJiraEvent,
  REQUIREMENT_STATE_WORDS,
  REQUIREMENT_STATES,
  REQUIREMENT_TRANSITIONS,
  REQUIREMENTS_PAGE_SIZE,
  requirementActions,
  requirementHrefs,
  requirementStateForWorkflow,
  stateAfterAnalysis,
  WORKFLOWS_PAGE_SIZE,
  type JiraWebhookEventLike,
  type RequirementState,
} from '../src/requirement-rules';
import { InvalidCursorError, encodeCursor } from '../src/read-model';
import { ROLES, WORKFLOW_STATES } from '../src/vocabulary';

const U1 = '00000000-0000-7000-8000-000000000001';
const T = '2026-09-14T09:00:00.000Z';

describe('US4 requirement state machine (data-model §28, research R32/R33)', () => {
  it('FR-009 REQUIREMENT_STATES lists the eight states in lifecycle order and REQUIREMENT_TRANSITIONS matches the R32 table', () => {
    expect(REQUIREMENT_STATES).toEqual([
      'DRAFT',
      'ANALYZING',
      'NEEDS_CLARIFICATION',
      'READY',
      'APPROVED',
      'IN_IMPLEMENTATION',
      'COMPLETED',
      'REJECTED',
    ]);
    expect(REQUIREMENT_TRANSITIONS).toEqual({
      CREATE: ['DRAFT'],
      DRAFT: ['ANALYZING', 'REJECTED'],
      ANALYZING: ['READY', 'NEEDS_CLARIFICATION'],
      NEEDS_CLARIFICATION: ['ANALYZING', 'READY', 'NEEDS_CLARIFICATION', 'REJECTED'],
      READY: ['APPROVED', 'REJECTED'],
      APPROVED: ['IN_IMPLEMENTATION', 'COMPLETED'],
      IN_IMPLEMENTATION: ['COMPLETED'],
      COMPLETED: [],
      REJECTED: [],
    });
    expect(isTerminalRequirement('COMPLETED')).toBe(true);
    expect(isTerminalRequirement('REJECTED')).toBe(true);
    for (const s of REQUIREMENT_STATES.filter((x) => x !== 'COMPLETED' && x !== 'REJECTED'))
      expect(isTerminalRequirement(s)).toBe(false);
    expect(canTransitionRequirement(null, 'DRAFT')).toBe(true);
    expect(canTransitionRequirement(null, 'READY')).toBe(false);
  });

  it('FR-009 canTransitionRequirement rejects ANALYZING→REJECTED and READY→ANALYZING', () => {
    expect(canTransitionRequirement('ANALYZING', 'REJECTED')).toBe(false);
    expect(canTransitionRequirement('READY', 'ANALYZING')).toBe(false);
    expect(canTransitionRequirement('DRAFT', 'ANALYZING')).toBe(true);
    expect(canTransitionRequirement('READY', 'APPROVED')).toBe(true);
    expect(canTransitionRequirement('COMPLETED', 'DRAFT')).toBe(false);
  });

  it('FR-009 stateAfterAnalysis returns READY for 0 open questions and NEEDS_CLARIFICATION otherwise', () => {
    expect(stateAfterAnalysis(0)).toBe('READY');
    expect(stateAfterAnalysis(1)).toBe('NEEDS_CLARIFICATION');
    expect(stateAfterAnalysis(20)).toBe('NEEDS_CLARIFICATION');
  });

  it('FR-010 requirementStateForWorkflow maps APPROVED+RUNNING→IN_IMPLEMENTATION, APPROVED+QUEUED|BLOCKED|CANCELLED→null, APPROVED|IN_IMPLEMENTATION+COMPLETED→COMPLETED, IN_IMPLEMENTATION+FAILED→null', () => {
    expect(requirementStateForWorkflow('APPROVED', 'RUNNING')).toBe('IN_IMPLEMENTATION');
    expect(requirementStateForWorkflow('APPROVED', 'WAITING_FOR_HUMAN')).toBe('IN_IMPLEMENTATION');
    expect(requirementStateForWorkflow('APPROVED', 'QUEUED')).toBeNull();
    expect(requirementStateForWorkflow('APPROVED', 'BLOCKED')).toBeNull();
    expect(requirementStateForWorkflow('APPROVED', 'CANCELLED')).toBeNull();
    expect(requirementStateForWorkflow('APPROVED', 'COMPLETED')).toBe('COMPLETED');
    expect(requirementStateForWorkflow('IN_IMPLEMENTATION', 'COMPLETED')).toBe('COMPLETED');
    expect(requirementStateForWorkflow('IN_IMPLEMENTATION', 'FAILED')).toBeNull();
    expect(requirementStateForWorkflow('IN_IMPLEMENTATION', 'RUNNING')).toBeNull();
    for (const w of WORKFLOW_STATES) {
      expect(requirementStateForWorkflow('READY', w)).toBeNull();
      expect(requirementStateForWorkflow('REJECTED', w)).toBeNull();
      expect(requirementStateForWorkflow('COMPLETED', w)).toBeNull();
    }
  });

  it('FR-032 requirementActions: engineer submits drafts and resubmits clarifications, approver approves READY and rejects, viewer nothing, nobody on ANALYZING/APPROVED/IN_IMPLEMENTATION/COMPLETED/REJECTED', () => {
    const none = { canSubmit: false, canApprove: false, canReject: false };

    expect(requirementActions('DRAFT', 'engineer')).toMatchObject({
      canSubmit: true,
      canApprove: false,
      canReject: false,
      submitLabel: 'Submit for analysis',
    });
    expect(requirementActions('NEEDS_CLARIFICATION', 'engineer')).toMatchObject({
      canSubmit: true,
      canApprove: false,
      canReject: false,
      submitLabel: 'Resubmit for analysis',
    });
    expect(requirementActions('READY', 'engineer')).toMatchObject(none);

    expect(requirementActions('READY', 'approver')).toMatchObject({
      canApprove: true,
      canReject: true,
    });
    expect(requirementActions('READY', 'administrator')).toMatchObject({
      canApprove: true,
      canReject: true,
    });
    const approverOnDraft = requirementActions('DRAFT', 'approver');
    expect(approverOnDraft).toMatchObject({ canReject: true, canApprove: false });
    expect(approverOnDraft.reasons).toContain('Analysis has not finished');
    expect(requirementActions('NEEDS_CLARIFICATION', 'approver')).toMatchObject({
      canSubmit: true,
      canApprove: false,
      canReject: true,
      submitLabel: 'Resubmit for analysis',
    });

    for (const state of REQUIREMENT_STATES) {
      const viewer = requirementActions(state, 'viewer');
      expect(viewer).toMatchObject(none);
      expect(viewer.reasons.length).toBeGreaterThanOrEqual(0);
    }
    const closed: RequirementState[] = [
      'ANALYZING',
      'APPROVED',
      'IN_IMPLEMENTATION',
      'COMPLETED',
      'REJECTED',
    ];
    for (const state of closed)
      for (const role of ROLES) expect(requirementActions(state, role)).toMatchObject(none);
  });
});

describe('US4 cursors, hrefs and words (research R38/R39/R41/R42)', () => {
  it('FR-007 encodeRequirementCursor/decodeRequirementCursor round-trip [requirements, createdAt, id] and reject a workflows cursor with InvalidCursorError', () => {
    expect(REQUIREMENTS_PAGE_SIZE).toBe(50);
    const cursor = encodeRequirementCursor({ createdAt: T, id: U1 });
    expect(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))).toEqual([
      'requirements',
      T,
      U1,
    ]);
    expect(decodeRequirementCursor(cursor)).toEqual({ createdAt: T, id: U1 });
    const wf = encodeWorkflowCursor({ stateObservedAt: T, id: U1 });
    expect(() => decodeRequirementCursor(wf)).toThrow(InvalidCursorError);
    expect(() => decodeRequirementCursor(encodeCursor('done', [T, U1]))).toThrow(
      InvalidCursorError,
    );
    expect(() => decodeRequirementCursor('not base64 json')).toThrow(InvalidCursorError);
  });

  it('FR-003 encodeWorkflowCursor/decodeWorkflowCursor round-trip and reject tampered input', () => {
    expect(WORKFLOWS_PAGE_SIZE).toBe(50);
    const cursor = encodeWorkflowCursor({ stateObservedAt: T, id: U1 });
    expect(decodeWorkflowCursor(cursor)).toEqual({ stateObservedAt: T, id: U1 });
    expect(() => decodeWorkflowCursor(encodeRequirementCursor({ createdAt: T, id: U1 }))).toThrow(
      InvalidCursorError,
    );
    const tampered = Buffer.from(JSON.stringify(['workflows', 42, U1]), 'utf8').toString(
      'base64url',
    );
    expect(() => decodeWorkflowCursor(tampered)).toThrow(InvalidCursorError);
    const short = Buffer.from(JSON.stringify(['workflows', T]), 'utf8').toString('base64url');
    expect(() => decodeWorkflowCursor(short)).toThrow(InvalidCursorError);
    expect(() => decodeWorkflowCursor('%%%')).toThrow(InvalidCursorError);
  });

  it('FR-009 requirementHrefs returns /requirements/{id}, /workflows/{id} and a list href with state/assignee/project params', () => {
    expect(requirementHrefs.requirement(U1)).toBe(`/requirements/${U1}`);
    expect(requirementHrefs.workflow(U1)).toBe(`/workflows/${U1}`);
    expect(requirementHrefs.list({})).toBe('/requirements');
    expect(requirementHrefs.list({ project: 'all' })).toBe('/requirements');
    expect(requirementHrefs.list({ state: ['READY', 'DRAFT'] })).toBe(
      '/requirements?state=READY,DRAFT',
    );
    expect(
      requirementHrefs.list({ project: U1, state: ['NEEDS_CLARIFICATION'], assignee: 'me' }),
    ).toBe(`/requirements?project=${U1}&state=NEEDS_CLARIFICATION&assignee=me`);
    expect(requirementHrefs.list({ assignee: 'unassigned', state: [] })).toBe(
      '/requirements?assignee=unassigned',
    );
  });

  it('FR-008 isSafeExternalUrl accepts https only', () => {
    expect(isSafeExternalUrl('https://jira.example.invalid/browse/PAY-231')).toBe(true);
    expect(isSafeExternalUrl('http://jira.example.invalid/browse/PAY-231')).toBe(false);
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeExternalUrl('//jira.example.invalid/browse/PAY-231')).toBe(false);
    expect(isSafeExternalUrl('HTTPS://x')).toBe(false);
  });

  it("FR-009 REQUIREMENT_STATE_WORDS has one lowercase word per state, 'needs clarification' for NEEDS_CLARIFICATION and 'in implementation' for IN_IMPLEMENTATION", () => {
    expect(Object.keys(REQUIREMENT_STATE_WORDS).sort()).toEqual([...REQUIREMENT_STATES].sort());
    for (const state of REQUIREMENT_STATES) {
      const word = REQUIREMENT_STATE_WORDS[state];
      expect(word).toBe(word.toLowerCase());
      expect(word.trim()).toBe(word);
      expect(word.length).toBeGreaterThan(0);
    }
    expect(REQUIREMENT_STATE_WORDS).toEqual({
      DRAFT: 'draft',
      ANALYZING: 'analyzing',
      NEEDS_CLARIFICATION: 'needs clarification',
      READY: 'ready',
      APPROVED: 'approved',
      IN_IMPLEMENTATION: 'in implementation',
      COMPLETED: 'completed',
      REJECTED: 'rejected',
    });
  });
});

describe('US4 Jira event mapping (research R36)', () => {
  const adf = {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Retry ' },
          { type: 'text', text: 'declined cards', marks: [{ type: 'strong' }] },
          { type: 'text', text: ' twice.' },
        ],
      },
      { type: 'paragraph', content: [{ type: 'text', text: 'Second paragraph.' }] },
    ],
  };
  const event = (
    webhookEvent: string,
    fields: Partial<JiraWebhookEventLike['issue']['fields']> = {},
  ): JiraWebhookEventLike => ({
    webhookEvent,
    issue: {
      key: 'PAY-241',
      fields: {
        summary: '  Retry queue for card declines  ',
        description: adf,
        updated: '2026-09-14T09:00:00.000+0000',
        project: { key: 'PAY' },
        status: { name: 'To Do', statusCategory: { key: 'new' } },
        assignee: { emailAddress: 'approver1@cdevi.demo' },
        ...fields,
      },
    },
  });

  it('FR-008 mapJiraEvent maps issue_created → create with title/objective/url(base)/assigneeEmail, issue_updated with statusCategory done → flag closed, issue_deleted → flag deleted, unknown event → ignore', () => {
    const created = mapJiraEvent(event('jira:issue_created'));
    expect(created).toMatchObject({
      kind: 'create',
      key: 'PAY-241',
      projectKey: 'PAY',
      title: 'Retry queue for card declines',
      objective: 'Retry declined cards twice.\nSecond paragraph.',
      updatedAt: T,
      flag: null,
      assigneeEmail: 'approver1@cdevi.demo',
    });
    expect(created.url('https://jira.example.invalid')).toBe(
      'https://jira.example.invalid/browse/PAY-241',
    );
    expect(created.url('https://jira.example.invalid/')).toBe(
      'https://jira.example.invalid/browse/PAY-241',
    );

    const updated = mapJiraEvent(event('jira:issue_updated'));
    expect(updated).toMatchObject({ kind: 'update', flag: null });

    const closed = mapJiraEvent(
      event('jira:issue_updated', {
        status: { name: 'Done', statusCategory: { key: 'done' } },
      }),
    );
    expect(closed).toMatchObject({ kind: 'flag', flag: 'closed', key: 'PAY-241' });

    const deleted = mapJiraEvent(event('jira:issue_deleted'));
    expect(deleted).toMatchObject({ kind: 'flag', flag: 'deleted' });

    expect(mapJiraEvent(event('comment_created'))).toMatchObject({ kind: 'ignore', flag: null });

    const bare = mapJiraEvent(
      event('jira:issue_created', { description: null, assignee: null, updated: undefined }),
    );
    expect(bare).toMatchObject({
      objective: 'Imported from Jira PAY-241',
      assigneeEmail: null,
      updatedAt: null,
    });
    expect(mapJiraEvent(event('jira:issue_created', { updated: 'garbage' })).updatedAt).toBeNull();
  });

  it('FR-008 adfToPlainText flattens paragraphs and truncates at 4 000 characters; string descriptions pass through', () => {
    expect(adfToPlainText(adf)).toBe('Retry declined cards twice.\nSecond paragraph.');
    expect(adfToPlainText('plain text')).toBe('plain text');
    expect(adfToPlainText(null)).toBe('');
    expect(adfToPlainText(undefined)).toBe('');
    expect(adfToPlainText({ type: 'doc', content: [] })).toBe('');
    const long = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x'.repeat(5000) }] }],
    };
    expect(adfToPlainText(long)).toHaveLength(4000);
    expect(adfToPlainText('y'.repeat(4500))).toHaveLength(4000);
    expect(adfToPlainText(long, 10)).toHaveLength(10);
    const nested = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }],
            },
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }],
            },
          ],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'a' },
            { type: 'hardBreak' },
            { type: 'text', text: 'b' },
          ],
        },
      ],
    };
    expect(adfToPlainText(nested)).toBe('one\ntwo\na\nb');
  });
});
