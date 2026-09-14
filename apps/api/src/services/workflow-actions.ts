/**
 * Human actions on a workflow (specs/001 research R5): retry / escalate / cancel. Role-gated with
 * `allowedActions`, every effect recorded in workflow_transitions with `user_id` so it shows in the activity feed.
 */
import {
  allowedActions,
  canTransition,
  isTerminal,
  type WorkflowActionRequest,
  type WorkflowState,
} from '@cdevi/contracts';
import type pg from 'pg';
import { problems } from '../lib/problem';
import type { SessionUser } from './auth';
import { loadStages, loadWorkflowHead, type DetailScope } from './workflow-detail';

export async function applyWorkflowAction(
  client: pg.PoolClient,
  user: SessionUser,
  scope: DetailScope,
  id: string,
  body: WorkflowActionRequest,
  now: Date,
): Promise<void> {
  const w = await loadWorkflowHead(client, scope, id, true);
  if (!w) throw problems.notFound("This workflow isn't available to you.");
  const allowed = allowedActions(user.role, w.state);
  if (!allowed[body.action]) {
    const roleMay = allowedActions(user.role, body.action === 'retry' ? 'FAILED' : 'BLOCKED');
    if (!roleMay[body.action])
      throw problems.forbidden(`Your role (${user.role}) may not ${body.action} workflows.`);
    throw problems.invalidTransition(`Cannot ${body.action} a workflow that is ${w.state}.`);
  }
  const stages = await loadStages(client, w.id);
  const record = async (
    stageId: string | null,
    from: WorkflowState,
    to: WorkflowState,
    reason: string,
  ) =>
    client.query(
      `INSERT INTO workflow_transitions (organization_id, workflow_id, stage_id, from_state, to_state, observed_at, reason, user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [scope.organizationId, w.id, stageId, from, to, now, reason, user.id],
    );

  if (body.action === 'escalate') {
    const reason = `Escalated by ${user.displayName}${body.note ? `: ${body.note}` : ''}`;
    await record(null, w.state, w.state, reason);
    await client.query(`UPDATE workflows SET updated_at = now() WHERE id = $1`, [w.id]);
    return;
  }

  if (body.action === 'retry') {
    const reason = `Retry requested by ${user.displayName}`;
    const failing = stages.find((s) => s.state === 'FAILED');
    if (failing && canTransition(failing.state, 'RETRYING')) {
      await client.query(
        `UPDATE workflow_stages SET state = 'RETRYING', state_observed_at = $2, state_reason = $3, finished_at = NULL, error_summary = NULL WHERE id = $1`,
        [failing.id, now, reason],
      );
      await record(failing.id, 'FAILED', 'RETRYING', reason);
    }
    await client.query(
      `UPDATE workflows SET state = 'RETRYING', state_observed_at = $2, state_reason = $3, finished_at = NULL WHERE id = $1`,
      [w.id, now, reason],
    );
    await record(null, w.state, 'RETRYING', reason);
    return;
  }

  const reason = `Cancelled by ${user.displayName}${body.note ? `: ${body.note}` : ''}`;
  for (const s of stages) {
    if (isTerminal(s.state) || !canTransition(s.state, 'CANCELLED')) continue;
    await client.query(
      `UPDATE workflow_stages SET state = 'CANCELLED', state_observed_at = $2, state_reason = $3, finished_at = $2 WHERE id = $1`,
      [s.id, now, reason],
    );
    await record(s.id, s.state, 'CANCELLED', reason);
  }
  await client.query(
    `UPDATE workflows SET state = 'CANCELLED', state_observed_at = $2, state_reason = $3, finished_at = $2 WHERE id = $1`,
    [w.id, now, reason],
  );
  await record(null, w.state, 'CANCELLED', reason);
}
