/**
 * Runtime analysis ingestion (specs/001 US4 scope decision 1, research R34): `PUT /ingest/requirements/{externalId}/analysis`.
 * The requirement row is locked, the principal must be scoped to its project, the state must accept an analysis
 * (ANALYZING | NEEDS_CLARIFICATION) and `observedAt` must move the `analysis_observed_at` watermark forward — otherwise
 * the delivery is `stale` and nothing is written. An accepted delivery replaces every AI-generated item (positions
 * 1..n per kind, `source = agent:<name>`), never touches human-authored items, and moves the requirement to READY or
 * NEEDS_CLARIFICATION through `stateAfterAnalysis`. Every call leaves one `ingestion_log` row.
 */
import type {
  RequirementAnalysisIngest,
  RequirementIngestResult,
  RequirementState,
} from '@cdevi/contracts';
import { canTransitionRequirement, stateAfterAnalysis } from '@cdevi/contracts/requirement-rules';
import type pg from 'pg';
import { ProblemError, problems } from '../lib/problem';
import type { IngestionPrincipal } from './auth';
import { recordRequirementTransition } from './requirements';

const ROUTE = 'PUT /ingest/requirements/{externalId}/analysis';
const ANALYSIS_STATES: readonly RequirementState[] = ['ANALYZING', 'NEEDS_CLARIFICATION'];

type Outcome = 'accepted' | 'stale' | 'rejected' | 'forbidden';

interface LockedRow {
  id: string;
  project_id: string;
  state: RequirementState;
  analysis_observed_at: Date | null;
}

async function log(
  client: pg.PoolClient | pg.Pool,
  principal: IngestionPrincipal,
  externalId: string,
  outcome: Outcome,
  detail?: string,
): Promise<void> {
  await client.query(
    `INSERT INTO ingestion_log (organization_id, principal_id, route, target_external_id, outcome, detail) VALUES ($1,$2,$3,$4,$5,$6)`,
    [principal.organizationId, principal.id, ROUTE, externalId, outcome, detail ?? null],
  );
}

export async function ingestRequirementAnalysis(
  pool: pg.Pool,
  principal: IngestionPrincipal,
  externalId: string,
  body: RequirementAnalysisIngest,
  now: Date,
): Promise<RequirementIngestResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.organization_id', $1, true)`, [
      principal.organizationId,
    ]);
    const result = await apply(client, principal, externalId, body, now);
    await log(client, principal, externalId, result.outcome);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if (e instanceof ProblemError) {
      const outcome: Outcome = e.status === 403 ? 'forbidden' : 'rejected';
      await log(
        pool,
        principal,
        externalId,
        outcome,
        `${e.status} ${e.title}: ${e.detail ?? ''}`.trim(),
      );
    }
    throw e;
  } finally {
    client.release();
  }
}

async function apply(
  client: pg.PoolClient,
  principal: IngestionPrincipal,
  externalId: string,
  body: RequirementAnalysisIngest,
  now: Date,
): Promise<RequirementIngestResult> {
  const locked = await client.query<LockedRow>(
    `SELECT id, project_id, state, analysis_observed_at FROM requirements
      WHERE organization_id = $1 AND external_id = $2 FOR UPDATE`,
    [principal.organizationId, externalId],
  );
  const row = locked.rows[0];
  if (!row) throw problems.notFound(`No requirement ${externalId}.`);
  if (!principal.projectIds.includes(row.project_id))
    throw problems.forbidden('This token is not scoped to that project.');
  const observedAt = new Date(body.observedAt);
  if (row.analysis_observed_at && observedAt.getTime() <= row.analysis_observed_at.getTime())
    return { outcome: 'stale', id: row.id, state: row.state };
  if (!ANALYSIS_STATES.includes(row.state))
    throw problems.invalidTransition(`A ${row.state} requirement does not accept analysis.`);

  const to = stateAfterAnalysis(body.openQuestions.length);
  if (!canTransitionRequirement(row.state, to))
    throw problems.invalidTransition(`Cannot move a ${row.state} requirement to ${to}.`);

  await client.query(
    `DELETE FROM requirement_analysis_items WHERE requirement_id = $1 AND ai_generated`,
    [row.id],
  );
  const source = `agent:${body.agent}`;
  const kinds: [string, string[]][] = [
    ['acceptance_criterion', body.acceptanceCriteria],
    ['rule', body.rules],
    ['open_question', body.openQuestions],
  ];
  for (const [kind, texts] of kinds) {
    if (texts.length === 0) continue;
    await client.query(
      `INSERT INTO requirement_analysis_items (organization_id, project_id, requirement_id, kind, position, text, ai_generated, source, created_at)
       SELECT $1, $2, $3, $4::analysis_item_kind, t.n, t.text, true, $6, $7 FROM unnest($5::text[]) WITH ORDINALITY AS t(text, n)`,
      [principal.organizationId, row.project_id, row.id, kind, texts, source, now],
    );
  }
  await client.query(
    `UPDATE requirements SET state = $2, analysis_observed_at = $3, analysis_agent = $4, analysis_summary = $5 WHERE id = $1`,
    [row.id, to, observedAt, body.agent, body.summary ?? null],
  );
  await recordRequirementTransition(
    client,
    principal.organizationId,
    row.id,
    row.state,
    to,
    { type: 'agent', id: principal.id, name: body.agent },
    body.openQuestions.length > 0
      ? `${body.openQuestions.length} open question(s)`
      : 'Analysis complete',
    now,
  );
  return { outcome: 'accepted', id: row.id, state: to };
}
