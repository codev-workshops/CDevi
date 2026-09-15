/**
 * Inbound Jira webhook (specs/001 US4, FR-008; research R35; data-model §22/§26).
 *
 * The route verifies `x-hub-signature` (HMAC-SHA256 over the raw body, constant-time compare) before the
 * body is even parsed. Verified events are mapped through `integration_project_mappings`; issue created /
 * updated create or update a `source = 'jira'` requirement, issue deleted or a transition to a *done*
 * status flags the requirement and moves its active linked workflow (and current stage) to BLOCKED. The
 * flag never changes the requirement state (spec.md edge case: a human decides).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ExternalFlag, JiraWebhookEvent, JiraWebhookResult, WorkflowState } from '@cdevi/contracts';
import { mapJiraEvent } from '@cdevi/contracts/requirement-rules';
import type pg from 'pg';
import { recordRequirementAudit, recordRequirementTransition } from './requirements';

const SIGNATURE_RE = /^sha256=([0-9a-f]{64})$/;
/** Workflow states that a Jira flag pauses; terminal and already-paused workflows are left alone. */
const ACTIVE_WORKFLOW_STATES: readonly WorkflowState[] = [
  'QUEUED',
  'RUNNING',
  'RETRYING',
  'WAITING',
  'WAITING_FOR_HUMAN',
];

export function verifyJiraSignature(
  raw: Buffer,
  header: string | undefined,
  secret: string | undefined,
): boolean {
  if (!secret || !header) return false;
  const m = SIGNATURE_RE.exec(header);
  if (!m?.[1]) return false;
  const expected = createHmac('sha256', secret).update(raw).digest();
  const given = Buffer.from(m[1], 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

interface Mapping {
  organization_id: string;
  project_id: string;
  external_base_url: string;
}

interface JiraRequirementRow {
  id: string;
  title: string;
  external_id: string;
  external_updated_at: string | null;
}

interface LinkedWorkflowRow {
  id: string;
  external_id: string;
  state: WorkflowState;
}

const SYSTEM_ACTOR = { type: 'system' as const, id: null, name: 'jira' };

async function resolveAssignee(
  client: pg.PoolClient,
  organizationId: string,
  email: string | null,
): Promise<string | null> {
  if (!email) return null;
  const r = await client.query<{ id: string }>(
    `SELECT id FROM users WHERE organization_id = $1 AND email = $2`,
    [organizationId, email],
  );
  return r.rows[0]?.id ?? null;
}

async function flagRequirement(
  client: pg.PoolClient,
  mapping: Mapping,
  requirement: JiraRequirementRow,
  key: string,
  flag: ExternalFlag,
  now: Date,
): Promise<JiraWebhookResult> {
  const wf = await client.query<LinkedWorkflowRow>(
    `SELECT id, external_id, state FROM workflows WHERE requirement_id = $1 FOR UPDATE`,
    [requirement.id],
  );
  const workflow = wf.rows[0] ?? null;
  const reason = `Jira ${key} ${flag} — human decision required`;
  let blocked = false;
  if (workflow && ACTIVE_WORKFLOW_STATES.includes(workflow.state)) {
    await client.query(
      `UPDATE workflow_stages SET state = 'BLOCKED', state_observed_at = $2, state_reason = $3
        WHERE id = (SELECT id FROM workflow_stages WHERE workflow_id = $1
                    AND state NOT IN ('COMPLETED','CANCELLED') ORDER BY position LIMIT 1)`,
      [workflow.id, now, reason],
    );
    await client.query(
      `UPDATE workflows SET state = 'BLOCKED', state_observed_at = $2, state_reason = $3 WHERE id = $1`,
      [workflow.id, now, reason],
    );
    await client.query(
      `INSERT INTO workflow_transitions (organization_id, workflow_id, stage_id, from_state, to_state, observed_at, reason)
       VALUES ($1,$2,NULL,$3,'BLOCKED',$4,$5)`,
      [mapping.organization_id, workflow.id, workflow.state, now, reason],
    );
    blocked = true;
  }
  await client.query(
    `UPDATE requirements SET external_flag = $2, external_flagged_at = $3 WHERE id = $1`,
    [requirement.id, flag, now],
  );
  await recordRequirementAudit(client, {
    organizationId: mapping.organization_id,
    projectId: mapping.project_id,
    workflowId: workflow?.id ?? null,
    actor: SYSTEM_ACTOR,
    action: 'requirement.flagged',
    targetType: 'requirement',
    targetId: requirement.id,
    result: blocked ? 'blocked' : 'flagged',
    details: {
      externalId: requirement.external_id,
      key,
      flag,
      workflowExternalId: workflow?.external_id ?? null,
      workflowState: blocked ? 'BLOCKED' : (workflow?.state ?? null),
    },
    occurredAt: now,
  });
  return { outcome: 'flagged', requirementId: requirement.id };
}

/** Applies one verified, validated Jira event inside `client`'s transaction. */
export async function applyJiraEvent(
  client: pg.PoolClient,
  event: JiraWebhookEvent,
  now: Date,
): Promise<JiraWebhookResult> {
  const { fields } = event.issue;
  const mapped = mapJiraEvent({
    webhookEvent: event.webhookEvent,
    issue: {
      key: event.issue.key,
      fields: {
        summary: fields.summary,
        description: fields.description,
        updated: fields.updated,
        project: { key: fields.project.key },
        status: fields.status
          ? {
              ...(fields.status.name !== undefined ? { name: fields.status.name } : {}),
              statusCategory: fields.status.statusCategory
                ? fields.status.statusCategory.key !== undefined
                  ? { key: fields.status.statusCategory.key }
                  : {}
                : null,
            }
          : null,
        assignee: fields.assignee ? { emailAddress: fields.assignee.emailAddress ?? null } : null,
      },
    },
  });
  if (mapped.kind === 'ignore') return { outcome: 'ignored', requirementId: null };

  const m = await client.query<Mapping>(
    `SELECT organization_id, project_id, external_base_url FROM integration_project_mappings
      WHERE provider = 'jira' AND external_project_key = $1`,
    [mapped.projectKey],
  );
  const mapping = m.rows[0];
  if (!mapping) return { outcome: 'ignored', requirementId: null };
  await client.query(`SELECT set_config('app.organization_id', $1, true)`, [mapping.organization_id]);

  const existing = await client.query<JiraRequirementRow>(
    `SELECT id, title, external_id, external_ref->>'updatedAt' AS external_updated_at FROM requirements
      WHERE organization_id = $1 AND source = 'jira' AND external_ref->>'key' = $2 FOR UPDATE`,
    [mapping.organization_id, mapped.key],
  );
  const current = existing.rows[0] ?? null;
  const updatedAt = mapped.updatedAt ?? now.toISOString();
  const externalRef = {
    provider: 'jira',
    key: mapped.key,
    url: mapped.url(mapping.external_base_url),
    updatedAt,
  };

  if (mapped.kind === 'flag') {
    if (!current) return { outcome: 'ignored', requirementId: null };
    return flagRequirement(client, mapping, current, mapped.key, mapped.flag!, now);
  }

  const assigneeId = await resolveAssignee(client, mapping.organization_id, mapped.assigneeEmail);

  if (current) {
    if (current.external_updated_at && Date.parse(updatedAt) <= Date.parse(current.external_updated_at))
      return { outcome: 'ignored', requirementId: current.id };
    await client.query(
      `UPDATE requirements SET title = $2, business_objective = $3, assignee_user_id = $4, external_ref = $5::jsonb
        WHERE id = $1`,
      [current.id, mapped.title, mapped.objective, assigneeId, JSON.stringify(externalRef)],
    );
    return { outcome: 'updated', requirementId: current.id };
  }

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO requirements (organization_id, project_id, external_id, title, business_objective, state, source, external_ref, assignee_user_id, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,'DRAFT','jira',$6::jsonb,$7,$8,$8) RETURNING id`,
    [
      mapping.organization_id,
      mapping.project_id,
      `req-${mapped.key.toLowerCase()}`,
      mapped.title,
      mapped.objective,
      JSON.stringify(externalRef),
      assigneeId,
      now,
    ],
  );
  const id = inserted.rows[0]!.id;
  await recordRequirementTransition(
    client,
    mapping.organization_id,
    id,
    null,
    'DRAFT',
    SYSTEM_ACTOR,
    `Imported from Jira ${mapped.key}`,
    now,
  );
  return { outcome: 'created', requirementId: id };
}
