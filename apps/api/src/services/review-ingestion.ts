/**
 * Runtime ingestion of pull requests, AI reviews and fix cycles (specs/001 US6, FR-018, FR-020, FR-034, FR-036).
 * Bearer principal scoped to the project, one transaction per request, `observedAt` watermark per row
 * (`stale` writes nothing), one `ingestion_log` row per request, never an `audit_events` row. The 0007 statement
 * triggers append exactly one `inbox_change_log` row per workflow per transaction — every route below touches at
 * least one review table row (the pull request, the review or the cycle) even when it replaces an empty finding set.
 *
 * Lock order (one discipline for every writer that touches both rows — this file and the finding actions):
 * workflow row first (`SELECT … FROM workflows … FOR UPDATE`), then the pull request row, then the review, cycle or
 * finding rows. The pull request and cycle routes take the workflow lock (they write the workflow / its stages);
 * the review route only writes review tables, so it takes the pull request lock alone — still a prefix-compatible
 * order. Findings are reconciled by (review, external_id) underneath the review lock: matched rows are updated in
 * place (the id survives — it is `audit_events.target_id` and the action routes' key), absent rows deleted, new
 * rows inserted; UNIQUE (review_id, position) is deferred for the transaction (0008) so positions can be reordered.
 */
import {
  canTransition,
  type FindingIngestStatus,
  type FindingState,
  type IngestResult,
  type PullRequestIngest,
  type ReviewCycleIngest,
  type ReviewIngest,
  type WorkflowState,
} from '@cdevi/contracts';
import type pg from 'pg';
import { ProblemError, problems } from '../lib/problem';
import type { IngestionPrincipal } from './auth';
import { syncWorkflowStagePointer } from './workflow-detail';

type Outcome = 'accepted' | 'stale' | 'rejected' | 'forbidden';

interface PullRequestRow {
  id: string;
  project_id: string;
  workflow_id: string;
  workflow_state: WorkflowState;
  observed_at: Date;
  review_stage_id: string | null;
}

interface PreservedFinding {
  external_id: string;
  state: FindingState;
  dismissed_reason: string | null;
  dismissed_by_user_id: string | null;
  dismissed_at: Date | null;
  fix_cycle_id: string | null;
  issue_requested_by_user_id: string | null;
  issue_requested_at: Date | null;
}

interface StageRow {
  id: string;
  state: WorkflowState;
  state_observed_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
}

const DEFAULT_MAX_ITERATIONS = 5;
const TERMINAL_CYCLE_STATES = ['COMPLETED', 'FAILED', 'CANCELLED'];

export class ReviewIngestionService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly principal: IngestionPrincipal,
    private readonly route: string,
    private readonly targetExternalId: string,
  ) {}

  private async log(client: pg.PoolClient | pg.Pool, outcome: Outcome, detail?: string) {
    await client.query(
      `INSERT INTO ingestion_log (organization_id, principal_id, route, target_external_id, outcome, detail) VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        this.principal.organizationId,
        this.principal.id,
        this.route,
        this.targetExternalId,
        outcome,
        detail ?? null,
      ],
    );
  }

  private async run<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.organization_id', $1, true)`, [
        this.principal.organizationId,
      ]);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      if (e instanceof ProblemError) {
        const outcome: Outcome = e.status === 403 ? 'forbidden' : 'rejected';
        await this.log(this.pool, outcome, `${e.status} ${e.title}: ${e.detail ?? ''}`.trim());
      }
      throw e;
    } finally {
      client.release();
    }
  }

  private assertScope(projectId: string) {
    if (!this.principal.projectIds.includes(projectId))
      throw problems.forbidden('This token is not scoped to that project.');
  }

  private async stale(client: pg.PoolClient, observedAt: string, stored: Date) {
    await this.log(
      client,
      'stale',
      `observedAt ${observedAt} is not newer than ${stored.toISOString()}`,
    );
  }

  /**
   * Resolves the pull request without locking, then locks the workflow row (when asked) before the pull request
   * row. `workflow_id` never changes once a pull request exists (`upsertPullRequest` rejects a different workflow),
   * so the unlocked read is a stable key for the workflow lock.
   */
  private async lockPullRequest(
    client: pg.PoolClient,
    externalId: string,
    opts: { workflowFirst: boolean },
  ): Promise<PullRequestRow> {
    const key = (
      await client.query<{ id: string; workflow_id: string }>(
        `SELECT id, workflow_id FROM pull_requests WHERE organization_id = $1 AND external_id = $2`,
        [this.principal.organizationId, externalId],
      )
    ).rows[0];
    if (!key) throw problems.notFound(`Unknown pull request ${externalId}.`);
    if (opts.workflowFirst)
      await client.query(`SELECT id FROM workflows WHERE id = $1 FOR UPDATE`, [key.workflow_id]);
    const pr = (
      await client.query<PullRequestRow>(
        `SELECT pr.id, pr.project_id, pr.workflow_id, w.state AS workflow_state, pr.observed_at, pr.review_stage_id
           FROM pull_requests pr JOIN workflows w ON w.id = pr.workflow_id
          WHERE pr.id = $1 FOR UPDATE OF pr`,
        [key.id],
      )
    ).rows[0];
    if (!pr) throw problems.notFound(`Unknown pull request ${externalId}.`);
    this.assertScope(pr.project_id);
    return pr;
  }

  private async agentRunId(
    client: pg.PoolClient,
    workflowId: string,
    externalId: string | undefined,
  ): Promise<string | null> {
    if (!externalId) return null;
    const r = await client.query<{ id: string }>(
      `SELECT id FROM agent_runs WHERE organization_id = $1 AND workflow_id = $2 AND external_id = $3`,
      [this.principal.organizationId, workflowId, externalId],
    );
    if (!r.rows[0]) throw problems.notFound(`Unknown agent run ${externalId} on this workflow.`);
    return r.rows[0].id;
  }

  /** `PUT /ingest/pull-requests/{externalId}` — one pull request per workflow, upserted by (organization, externalId). */
  async upsertPullRequest(externalId: string, body: PullRequestIngest): Promise<IngestResult> {
    return this.run(async (client) => {
      const w = (
        await client.query<{ id: string; project_id: string; state: WorkflowState }>(
          `SELECT id, project_id, state FROM workflows WHERE organization_id = $1 AND external_id = $2 FOR UPDATE`,
          [this.principal.organizationId, body.workflowExternalId],
        )
      ).rows[0];
      if (!w) throw problems.notFound(`Unknown workflow ${body.workflowExternalId}.`);
      this.assertScope(w.project_id);
      let requirementId: string | null = null;
      if (body.requirementExternalId) {
        const rq = (
          await client.query<{ id: string }>(
            `SELECT id FROM requirements WHERE organization_id = $1 AND external_id = $2`,
            [this.principal.organizationId, body.requirementExternalId],
          )
        ).rows[0];
        if (!rq) throw problems.notFound(`Unknown requirement ${body.requirementExternalId}.`);
        requirementId = rq.id;
      }
      let reviewStageId: string | null = null;
      if (body.reviewStagePosition != null) {
        const stage = (
          await client.query<{ id: string }>(
            `SELECT id FROM workflow_stages WHERE workflow_id = $1 AND position = $2`,
            [w.id, body.reviewStagePosition],
          )
        ).rows[0];
        if (!stage)
          throw problems.validation([
            { path: 'reviewStagePosition', message: 'no such stage on this workflow' },
          ]);
        reviewStageId = stage.id;
      }
      const existing = (
        await client.query<{ id: string; workflow_id: string; observed_at: Date }>(
          `SELECT id, workflow_id, observed_at FROM pull_requests WHERE organization_id = $1 AND external_id = $2 FOR UPDATE`,
          [this.principal.organizationId, externalId],
        )
      ).rows[0];
      const observedAt = new Date(body.observedAt);
      if (existing) {
        if (existing.workflow_id !== w.id)
          throw problems.invalidTransition(
            `Pull request ${externalId} belongs to another workflow.`,
          );
        if (observedAt.getTime() <= existing.observed_at.getTime()) {
          await this.stale(client, body.observedAt, existing.observed_at);
          return { outcome: 'stale', id: existing.id, state: w.state };
        }
        await client.query(
          `UPDATE pull_requests SET requirement_id = $2, number = $3, title = $4, href = $5, status = $6, observed_at = $7, review_stage_id = $8 WHERE id = $1`,
          [
            existing.id,
            requirementId,
            body.number,
            body.title,
            body.href,
            body.status,
            observedAt,
            reviewStageId,
          ],
        );
        await this.log(client, 'accepted');
        return { outcome: 'accepted', id: existing.id, state: w.state };
      }
      const taken = (
        await client.query<{ external_id: string }>(
          `SELECT external_id FROM pull_requests WHERE workflow_id = $1`,
          [w.id],
        )
      ).rows[0];
      if (taken)
        throw problems.invalidTransition(
          `Workflow ${body.workflowExternalId} already has pull request ${taken.external_id}.`,
        );
      const id = (
        await client.query<{ id: string }>(
          `INSERT INTO pull_requests (organization_id, project_id, workflow_id, requirement_id, external_id, number, title, href, status, observed_at, review_stage_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
          [
            this.principal.organizationId,
            w.project_id,
            w.id,
            requirementId,
            externalId,
            body.number,
            body.title,
            body.href,
            body.status,
            observedAt,
            reviewStageId,
          ],
        )
      ).rows[0]!.id;
      await this.log(client, 'accepted');
      return { outcome: 'accepted', id, state: w.state };
    });
  }

  /**
   * `PUT /ingest/pull-requests/{externalId}/reviews/{cycle}` — upserts the review of that cycle and reconciles its
   * finding set with the snapshot by externalId: matched rows are updated in place and keep their id, rows absent
   * from the snapshot are deleted, the rest inserted (ids server-side). Human outcomes survive by externalId:
   * DISMISSED and ISSUE_REQUESTED keep their state and metadata, FIX_REQUESTED keeps its cycle until the runtime
   * reports FIXED. The cycles route owns `review_cycles`; nothing here touches them.
   */
  async replaceReview(
    externalId: string,
    cycle: number,
    body: ReviewIngest,
  ): Promise<IngestResult> {
    return this.run(async (client) => {
      const pr = await this.lockPullRequest(client, externalId, { workflowFirst: false });
      const existing = (
        await client.query<{ id: string; observed_at: Date }>(
          `SELECT id, observed_at FROM reviews WHERE pull_request_id = $1 AND cycle_number = $2 FOR UPDATE`,
          [pr.id, cycle],
        )
      ).rows[0];
      const observedAt = new Date(body.observedAt);
      if (existing && observedAt.getTime() <= existing.observed_at.getTime()) {
        await this.stale(client, body.observedAt, existing.observed_at);
        return { outcome: 'stale', id: existing.id, state: pr.workflow_state };
      }
      const agentRunId = await this.agentRunId(client, pr.workflow_id, body.agentRunExternalId);
      const lanes = JSON.stringify(body.lanes);
      let reviewId: string;
      if (existing) {
        reviewId = existing.id;
        await client.query(
          `UPDATE reviews SET status = $2, lanes = $3, observed_at = $4, started_at = $5, finished_at = $6, agent_run_id = $7, external_id = $8 WHERE id = $1`,
          [
            reviewId,
            body.status,
            lanes,
            observedAt,
            new Date(body.startedAt),
            body.finishedAt ? new Date(body.finishedAt) : null,
            agentRunId,
            body.externalId,
          ],
        );
      } else {
        reviewId = (
          await client.query<{ id: string }>(
            `INSERT INTO reviews (organization_id, project_id, workflow_id, pull_request_id, external_id, cycle_number, status, lanes, observed_at, started_at, finished_at, agent_run_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
            [
              this.principal.organizationId,
              pr.project_id,
              pr.workflow_id,
              pr.id,
              body.externalId,
              cycle,
              body.status,
              lanes,
              observedAt,
              new Date(body.startedAt),
              body.finishedAt ? new Date(body.finishedAt) : null,
              agentRunId,
            ],
          )
        ).rows[0]!.id;
      }

      // A finding keeps its runtime externalId across cycles (unique per review, not per PR): the human outcome
      // recorded on this review's own row wins, otherwise the one on the most recent earlier cycle carries over.
      const preserved = new Map(
        (
          await client.query<PreservedFinding>(
            `SELECT DISTINCT ON (f.external_id)
                    f.external_id, f.state, f.dismissed_reason, f.dismissed_by_user_id, f.dismissed_at, f.fix_cycle_id,
                    f.issue_requested_by_user_id, f.issue_requested_at
             FROM review_findings f JOIN reviews r ON r.id = f.review_id
             WHERE f.pull_request_id = $2 AND f.external_id = ANY($3::text[])
             ORDER BY f.external_id, (f.review_id = $1) DESC, r.cycle_number DESC`,
            [reviewId, pr.id, body.findings.map((f) => f.externalId)],
          )
        ).rows.map((f) => [f.external_id, f] as const),
      );
      const incoming = body.findings.map((f) => f.externalId);
      const current = new Map(
        (
          await client.query<{ id: string; external_id: string }>(
            `SELECT id, external_id FROM review_findings WHERE review_id = $1 FOR UPDATE`,
            [reviewId],
          )
        ).rows.map((r) => [r.external_id, r.id] as const),
      );
      await client.query(
        `DELETE FROM review_findings WHERE review_id = $1 AND external_id <> ALL($2::text[])`,
        [reviewId, incoming],
      );
      await client.query(`SET CONSTRAINTS review_findings_review_id_position_key DEFERRED`);
      for (const f of body.findings) {
        const prev = preserved.get(f.externalId);
        const state = mergedState(prev?.state, f.status);
        const keep = prev && state === prev.state ? prev : null;
        const content = [
          f.position,
          f.lane,
          f.severity,
          f.blocking,
          f.title,
          f.description,
          f.impact,
          JSON.stringify(f.evidence),
          f.recommendedFix,
          state,
          keep?.dismissed_reason ?? null,
          keep?.dismissed_by_user_id ?? null,
          keep?.dismissed_at ?? null,
          prev?.fix_cycle_id ?? null,
          keep?.issue_requested_by_user_id ?? null,
          keep?.issue_requested_at ?? null,
        ];
        const id = current.get(f.externalId);
        if (id) {
          await client.query(
            `UPDATE review_findings
                SET position = $2, lane = $3, severity = $4, blocking = $5, title = $6, description = $7, impact = $8,
                    evidence = $9, recommended_fix = $10, state = $11, dismissed_reason = $12, dismissed_by_user_id = $13,
                    dismissed_at = $14, fix_cycle_id = $15, issue_requested_by_user_id = $16, issue_requested_at = $17
              WHERE id = $1`,
            [id, ...content],
          );
        } else {
          await client.query(
            `INSERT INTO review_findings (organization_id, project_id, workflow_id, pull_request_id, review_id, external_id, position, lane, severity, blocking,
                                          title, description, impact, evidence, recommended_fix, state, dismissed_reason, dismissed_by_user_id, dismissed_at,
                                          fix_cycle_id, issue_requested_by_user_id, issue_requested_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
            [
              this.principal.organizationId,
              pr.project_id,
              pr.workflow_id,
              pr.id,
              reviewId,
              f.externalId,
              ...content,
            ],
          );
        }
      }
      await client.query(`SET CONSTRAINTS review_findings_review_id_position_key IMMEDIATE`);
      await this.log(client, 'accepted');
      return { outcome: 'accepted', id: reviewId, state: pr.workflow_state };
    });
  }

  /**
   * `PUT /ingest/pull-requests/{externalId}/cycles/{cycle}` — upserts the fix cycle; a cycle already terminal is a
   * 409, and so is a new cycle that is not the next number (`max + 1`) — cycle numbers are the fix-loop history and
   * decide which cycle may move the stage, so a gap is never accepted. COMPLETED / FAILED move the workflow's Review
   * stage the way the stage ingest route does (state machine, `workflow_transitions` row with `principal_id`, stage
   * pointer re-synced); CANCELLED leaves the stage alone.
   */
  async upsertCycle(
    externalId: string,
    cycle: number,
    body: ReviewCycleIngest,
  ): Promise<IngestResult> {
    return this.run(async (client) => {
      const pr = await this.lockPullRequest(client, externalId, { workflowFirst: true });
      const existing = (
        await client.query<{
          id: string;
          state: string;
          observed_at: Date;
          max_iterations: number;
          started_at: Date;
        }>(
          `SELECT id, state, observed_at, max_iterations, started_at FROM review_cycles WHERE pull_request_id = $1 AND cycle_number = $2 FOR UPDATE`,
          [pr.id, cycle],
        )
      ).rows[0];
      const observedAt = new Date(body.observedAt);
      if (existing && observedAt.getTime() <= existing.observed_at.getTime()) {
        await this.stale(client, body.observedAt, existing.observed_at);
        return { outcome: 'stale', id: existing.id, state: pr.workflow_state };
      }
      if (existing && TERMINAL_CYCLE_STATES.includes(existing.state))
        throw problems.invalidTransition(`Cycle ${cycle} is already ${existing.state}.`);
      const highest =
        (
          await client.query<{ n: number | null }>(
            `SELECT max(cycle_number) AS n FROM review_cycles WHERE pull_request_id = $1`,
            [pr.id],
          )
        ).rows[0]!.n ?? 0;
      if (!existing && cycle !== highest + 1)
        throw problems.invalidTransition(
          `Cycle ${cycle} is not the next cycle of this pull request (expected ${highest + 1}).`,
        );
      const maxIterations =
        body.maxIterations ?? existing?.max_iterations ?? DEFAULT_MAX_ITERATIONS;
      if (body.iteration > maxIterations)
        throw problems.validation([
          { path: 'iteration', message: `must not exceed maxIterations (${maxIterations})` },
        ]);
      if (body.state === 'RUNNING') {
        // One fix loop per pull request (review_cycles_one_running_idx): a 409 instead of a unique violation.
        const other = (
          await client.query<{ cycle_number: number }>(
            `SELECT cycle_number FROM review_cycles WHERE pull_request_id = $1 AND state = 'RUNNING' AND cycle_number <> $2`,
            [pr.id, cycle],
          )
        ).rows[0];
        if (other)
          throw problems.invalidTransition(
            `Cycle ${other.cycle_number} is still RUNNING on this pull request.`,
          );
      }
      const agentRunId = await this.agentRunId(client, pr.workflow_id, body.agentRunExternalId);
      const finishedAt = body.finishedAt
        ? new Date(body.finishedAt)
        : TERMINAL_CYCLE_STATES.includes(body.state)
          ? observedAt
          : null;
      let id: string;
      if (existing) {
        id = existing.id;
        await client.query(
          `UPDATE review_cycles SET findings_count = $2, fixed_count = $3, remaining_count = $4, iteration = $5, max_iterations = $6, state = $7,
                  started_at = $8, finished_at = $9, agent_run_id = COALESCE($10, agent_run_id), observed_at = $11 WHERE id = $1`,
          [
            id,
            body.findingsCount,
            body.fixedCount,
            body.remainingCount,
            body.iteration,
            maxIterations,
            body.state,
            new Date(body.startedAt),
            finishedAt,
            agentRunId,
            observedAt,
          ],
        );
      } else {
        id = (
          await client.query<{ id: string }>(
            `INSERT INTO review_cycles (organization_id, project_id, workflow_id, pull_request_id, cycle_number, findings_count, fixed_count, remaining_count,
                                        iteration, max_iterations, state, requested_by_agent, started_at, finished_at, agent_run_id, observed_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
            [
              this.principal.organizationId,
              pr.project_id,
              pr.workflow_id,
              pr.id,
              cycle,
              body.findingsCount,
              body.fixedCount,
              body.remainingCount,
              body.iteration,
              maxIterations,
              body.state,
              this.principal.name,
              new Date(body.startedAt),
              finishedAt,
              agentRunId,
              observedAt,
            ],
          )
        ).rows[0]!.id;
      }
      // The Review stage mirrors the pull request's current fix loop: only its latest cycle may move it.
      const latest = existing ? highest : cycle;
      if ((body.state === 'COMPLETED' || body.state === 'FAILED') && cycle === latest)
        await this.syncReviewStage(client, pr, body.state, observedAt, cycle);
      await this.log(client, 'accepted');
      return { outcome: 'accepted', id, state: pr.workflow_state };
    });
  }

  /** The stage linked on the pull request (`review_stage_id`), else the stage named Review; none → stages untouched. */
  private async syncReviewStage(
    client: pg.PoolClient,
    pr: PullRequestRow,
    to: 'COMPLETED' | 'FAILED',
    observedAt: Date,
    cycle: number,
  ): Promise<void> {
    const workflowId = pr.workflow_id;
    const stage = (
      await client.query<StageRow>(
        `SELECT id, state, state_observed_at, started_at, finished_at FROM workflow_stages
          WHERE workflow_id = $1 AND id = COALESCE($2::uuid, (SELECT id FROM workflow_stages WHERE workflow_id = $1 AND name = 'Review' ORDER BY position LIMIT 1))
          FOR UPDATE`,
        [workflowId, pr.review_stage_id],
      )
    ).rows[0];
    if (!stage || stage.state === to) return;
    if (observedAt.getTime() <= stage.state_observed_at.getTime()) return;
    if (!canTransition(stage.state, to)) return;
    const reason = `Fix cycle ${cycle} ${to.toLowerCase()}`;
    await client.query(
      `UPDATE workflow_stages SET state = $2, state_observed_at = $3, state_reason = $4, finished_at = COALESCE(finished_at, $3) WHERE id = $1`,
      [stage.id, to, observedAt, reason],
    );
    await client.query(
      `INSERT INTO workflow_transitions (organization_id, workflow_id, stage_id, from_state, to_state, observed_at, reason, principal_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        this.principal.organizationId,
        workflowId,
        stage.id,
        stage.state,
        to,
        observedAt,
        reason,
        this.principal.id,
      ],
    );
    await syncWorkflowStagePointer(client, workflowId);
  }
}

/** The stored human outcome wins; the runtime may only open a finding or report it FIXED. */
function mergedState(prev: FindingState | undefined, reported: FindingIngestStatus): FindingState {
  if (prev === 'DISMISSED' || prev === 'ISSUE_REQUESTED') return prev;
  if (prev === 'FIX_REQUESTED') return reported === 'fixed' ? 'FIXED' : 'FIX_REQUESTED';
  return reported === 'fixed' ? 'FIXED' : 'OPEN';
}
