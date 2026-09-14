import {
  canTransition,
  type AgentRunUpsert,
  type ApprovalUpsert,
  type ArtifactUpsert,
  type ClarificationUpsert,
  type IngestResult,
  type StageUpsert,
  type TestRunUpsert,
  type Transition,
  type WorkflowState,
  type WorkflowUpsert,
} from '@cdevi/contracts';
import type pg from 'pg';
import { ProblemError, problems } from '../lib/problem';
import type { IngestionPrincipal } from './auth';
import { syncWorkflowStagePointer } from './workflow-detail';

type Outcome = 'accepted' | 'stale' | 'rejected' | 'forbidden';

interface WorkflowRow {
  id: string;
  project_id: string;
  state: WorkflowState;
  state_observed_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
}

interface StageDbRow {
  id: string;
  position: number;
  name: string;
  state: WorkflowState;
  state_observed_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  error_summary: string | null;
}

export class IngestionService {
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

  /** Runs `fn` in a transaction; on a ProblemError logs the outcome (in its own statement) and rethrows. */
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

  private async lockWorkflow(
    client: pg.PoolClient,
    externalId: string,
  ): Promise<WorkflowRow | undefined> {
    const r = await client.query<WorkflowRow>(
      `SELECT id, project_id, state, state_observed_at, started_at, finished_at FROM workflows WHERE organization_id = $1 AND external_id = $2 FOR UPDATE`,
      [this.principal.organizationId, externalId],
    );
    return r.rows[0];
  }

  private async applyTransition(
    client: pg.PoolClient,
    w: WorkflowRow,
    t: Transition,
  ): Promise<'accepted' | 'stale'> {
    const observedAt = new Date(t.observedAt);
    if (observedAt.getTime() <= w.state_observed_at.getTime()) {
      await this.log(
        client,
        'stale',
        `observedAt ${t.observedAt} is not newer than ${w.state_observed_at.toISOString()}`,
      );
      return 'stale';
    }
    if (!canTransition(w.state, t.toState))
      throw problems.invalidTransition(`Cannot move from ${w.state} to ${t.toState}.`);
    const startedAt = t.toState === 'RUNNING' && !w.started_at ? observedAt : w.started_at;
    const finishedAt = t.toState === 'COMPLETED' || t.toState === 'CANCELLED' ? observedAt : null;
    await client.query(
      `UPDATE workflows SET state = $2, state_observed_at = $3, state_reason = $4, started_at = $5, finished_at = $6,
         stage_index = COALESCE($7, stage_index), stage_count = COALESCE($8, stage_count), stage_name = COALESCE($9, stage_name)
       WHERE id = $1`,
      [
        w.id,
        t.toState,
        observedAt,
        t.reason ?? null,
        startedAt,
        finishedAt,
        t.stage?.index ?? null,
        t.stage?.count ?? null,
        t.stage?.name ?? null,
      ],
    );
    await client.query(
      `INSERT INTO workflow_transitions (organization_id, workflow_id, from_state, to_state, observed_at, reason, principal_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        this.principal.organizationId,
        w.id,
        w.state,
        t.toState,
        observedAt,
        t.reason ?? null,
        this.principal.id,
      ],
    );
    w.state = t.toState;
    w.state_observed_at = observedAt;
    w.started_at = startedAt;
    w.finished_at = finishedAt;
    return 'accepted';
  }

  async upsertWorkflow(externalId: string, body: WorkflowUpsert): Promise<IngestResult> {
    return this.run(async (client) => {
      const project = (
        await client.query<{ id: string }>(
          `SELECT id FROM projects WHERE organization_id = $1 AND key = $2`,
          [this.principal.organizationId, body.projectKey],
        )
      ).rows[0];
      if (!project) throw problems.notFound(`Unknown project ${body.projectKey}.`);
      this.assertScope(project.id);
      let w = await this.lockWorkflow(client, externalId);
      let outcome: 'accepted' | 'stale' = 'accepted';
      if (!w) {
        const initial = body.state ?? 'QUEUED';
        if (!canTransition(null, initial))
          throw problems.invalidTransition(`A new workflow cannot start in ${initial}.`);
        const observedAt = new Date(body.observedAt);
        const r = await client.query<WorkflowRow>(
          `INSERT INTO workflows (organization_id, project_id, external_id, title, agent, state, state_observed_at, state_reason, stage_index, stage_count, stage_name, pull_request_ref, started_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id, project_id, state, state_observed_at, started_at, finished_at`,
          [
            this.principal.organizationId,
            project.id,
            externalId,
            body.title,
            body.agent ?? null,
            initial,
            observedAt,
            body.reason ?? null,
            body.stage?.index ?? null,
            body.stage?.count ?? 7,
            body.stage?.name ?? null,
            body.pullRequestRef ?? null,
            initial === 'RUNNING' ? observedAt : null,
          ],
        );
        w = r.rows[0]!;
        await client.query(
          `INSERT INTO workflow_transitions (organization_id, workflow_id, from_state, to_state, observed_at, reason, principal_id) VALUES ($1,$2,NULL,$3,$4,$5,$6)`,
          [
            this.principal.organizationId,
            w.id,
            initial,
            observedAt,
            body.reason ?? null,
            this.principal.id,
          ],
        );
      } else {
        this.assertScope(w.project_id);
        await client.query(
          `UPDATE workflows SET title = $2, agent = COALESCE($3, agent), pull_request_ref = COALESCE($4, pull_request_ref), project_id = $5,
             stage_index = COALESCE($6, stage_index), stage_count = COALESCE($7, stage_count), stage_name = COALESCE($8, stage_name) WHERE id = $1`,
          [
            w.id,
            body.title,
            body.agent ?? null,
            body.pullRequestRef ?? null,
            project.id,
            body.stage?.index ?? null,
            body.stage?.count ?? null,
            body.stage?.name ?? null,
          ],
        );
        if (body.state && body.state !== w.state) {
          outcome = await this.applyTransition(client, w, {
            toState: body.state,
            observedAt: body.observedAt,
            reason: body.reason ?? null,
            stage: body.stage ?? null,
          });
        }
      }
      if (outcome === 'accepted') await this.log(client, 'accepted');
      return { outcome, id: w.id, state: w.state };
    });
  }

  async transition(externalId: string, body: Transition): Promise<IngestResult> {
    return this.run(async (client) => {
      const w = await this.lockWorkflow(client, externalId);
      if (!w) throw problems.notFound(`Unknown workflow ${externalId}.`);
      this.assertScope(w.project_id);
      const outcome = await this.applyTransition(client, w, body);
      if (outcome === 'accepted') await this.log(client, 'accepted');
      return { outcome, id: w.id, state: w.state };
    });
  }

  private async assertNoOtherPending(
    client: pg.PoolClient,
    workflowId: string,
    exceptTable: 'approvals' | 'clarifications',
    exceptExternalId: string,
  ) {
    const pendingApprovals = await client.query(
      `SELECT external_id FROM approvals WHERE workflow_id = $1 AND decision IS NULL ${exceptTable === 'approvals' ? 'AND external_id <> $2' : 'AND $2 = $2'}`,
      [workflowId, exceptExternalId],
    );
    const pendingClarifications = await client.query(
      `SELECT external_id FROM clarifications WHERE workflow_id = $1 AND answered_at IS NULL ${exceptTable === 'clarifications' ? 'AND external_id <> $2' : 'AND $2 = $2'}`,
      [workflowId, exceptExternalId],
    );
    if ((pendingApprovals.rowCount ?? 0) + (pendingClarifications.rowCount ?? 0) > 0)
      throw problems.pendingRequestExists(
        'This workflow already has a pending approval or clarification.',
      );
  }

  async upsertApproval(externalId: string, body: ApprovalUpsert): Promise<IngestResult> {
    return this.run(async (client) => {
      const w = await this.lockWorkflow(client, body.workflowExternalId);
      if (!w) throw problems.notFound(`Unknown workflow ${body.workflowExternalId}.`);
      this.assertScope(w.project_id);
      if (!body.decision) await this.assertNoOtherPending(client, w.id, 'approvals', externalId);
      const r = await client.query<{ id: string }>(
        `INSERT INTO approvals (organization_id, project_id, workflow_id, external_id, ask, risk_level, requested_by_agent, requested_at, expires_at, decision, decided_at, decided_by, context, links)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (organization_id, external_id) DO UPDATE SET ask = EXCLUDED.ask, risk_level = EXCLUDED.risk_level, requested_by_agent = COALESCE(EXCLUDED.requested_by_agent, approvals.requested_by_agent),
           expires_at = EXCLUDED.expires_at, decision = COALESCE(EXCLUDED.decision, approvals.decision), decided_at = COALESCE(EXCLUDED.decided_at, approvals.decided_at), decided_by = COALESCE(EXCLUDED.decided_by, approvals.decided_by),
           context = COALESCE(EXCLUDED.context, approvals.context), links = EXCLUDED.links
         RETURNING id`,
        [
          this.principal.organizationId,
          w.project_id,
          w.id,
          externalId,
          body.ask,
          body.riskLevel,
          body.requestedByAgent ?? null,
          new Date(body.requestedAt),
          body.expiresAt ? new Date(body.expiresAt) : null,
          body.decision?.outcome ?? null,
          body.decision ? new Date(body.decision.decidedAt) : null,
          body.decision?.decidedBy ?? null,
          body.context ?? null,
          JSON.stringify(body.links ?? {}),
        ],
      );
      await this.log(client, 'accepted');
      return { outcome: 'accepted', id: r.rows[0]!.id, state: w.state };
    });
  }

  // ---- specs/001 US1 extensions (data-model.md §5, §8)

  private async lockStage(
    client: pg.PoolClient,
    workflowId: string,
    position: number,
  ): Promise<StageDbRow | undefined> {
    const r = await client.query<StageDbRow>(
      `SELECT id, position, name, state, state_observed_at, started_at, finished_at, error_summary
         FROM workflow_stages WHERE workflow_id = $1 AND position = $2 FOR UPDATE`,
      [workflowId, position],
    );
    return r.rows[0];
  }

  private async requireStage(client: pg.PoolClient, workflowId: string, position: number) {
    const s = await this.lockStage(client, workflowId, position);
    if (!s) throw problems.unknownStage(`This workflow has no stage at position ${position}.`);
    return s;
  }

  private async linkedRequest(
    client: pg.PoolClient,
    table: 'approvals' | 'clarifications',
    workflowId: string,
    externalId: string | null | undefined,
  ): Promise<string | null> {
    if (!externalId) return null;
    const r = await client.query<{ id: string }>(
      `SELECT id FROM ${table} WHERE organization_id = $1 AND workflow_id = $2 AND external_id = $3`,
      [this.principal.organizationId, workflowId, externalId],
    );
    if (!r.rows[0])
      throw problems.notFound(`Unknown ${table.slice(0, -1)} ${externalId} on this workflow.`);
    return r.rows[0].id;
  }

  /** An external id names one record inside one workflow; reusing it for another workflow is rejected. */
  private async assertOwnedBy(
    client: pg.PoolClient,
    table: 'agent_runs' | 'artifacts' | 'test_runs',
    externalId: string,
    workflowId: string,
  ) {
    const r = await client.query<{ workflow_id: string }>(
      `SELECT workflow_id FROM ${table} WHERE organization_id = $1 AND external_id = $2`,
      [this.principal.organizationId, externalId],
    );
    const owner = r.rows[0]?.workflow_id;
    if (owner && owner !== workflowId)
      throw problems.invalidTransition(
        `${table.replace('_', ' ').slice(0, -1)} ${externalId} belongs to another workflow.`,
      );
  }

  async upsertStage(
    workflowExternalId: string,
    position: number,
    body: StageUpsert,
  ): Promise<IngestResult> {
    return this.run(async (client) => {
      const w = await this.lockWorkflow(client, workflowExternalId);
      if (!w) throw problems.notFound(`Unknown workflow ${workflowExternalId}.`);
      this.assertScope(w.project_id);
      const observedAt = new Date(body.observedAt);
      const approvalId = await this.linkedRequest(
        client,
        'approvals',
        w.id,
        body.approvalExternalId,
      );
      const clarificationId = await this.linkedRequest(
        client,
        'clarifications',
        w.id,
        body.clarificationExternalId,
      );
      const existing = await this.lockStage(client, w.id, position);
      let stageId: string;
      if (!existing) {
        if (!canTransition(null, body.state))
          throw problems.invalidTransition(`A new stage cannot start in ${body.state}.`);
        const r = await client.query<{ id: string }>(
          `INSERT INTO workflow_stages (organization_id, project_id, workflow_id, position, name, state, state_observed_at, state_reason, agent,
             started_at, finished_at, error_summary, requires_approval, approval_id, clarification_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
          [
            this.principal.organizationId,
            w.project_id,
            w.id,
            position,
            body.name,
            body.state,
            observedAt,
            body.reason ?? null,
            body.agent ?? null,
            body.state === 'RUNNING' ? observedAt : null,
            null,
            body.state === 'FAILED' ? (body.errorSummary ?? body.reason ?? null) : null,
            body.requiresApproval,
            approvalId,
            clarificationId,
          ],
        );
        stageId = r.rows[0]!.id;
        await client.query(
          `INSERT INTO workflow_transitions (organization_id, workflow_id, stage_id, from_state, to_state, observed_at, reason, principal_id) VALUES ($1,$2,$3,NULL,$4,$5,$6,$7)`,
          [
            this.principal.organizationId,
            w.id,
            stageId,
            body.state,
            observedAt,
            body.reason ?? null,
            this.principal.id,
          ],
        );
      } else {
        stageId = existing.id;
        if (observedAt.getTime() <= existing.state_observed_at.getTime()) {
          await this.log(
            client,
            'stale',
            `observedAt ${body.observedAt} is not newer than ${existing.state_observed_at.toISOString()}`,
          );
          return { outcome: 'stale', id: existing.id, state: w.state };
        }
        if (body.state !== existing.state && !canTransition(existing.state, body.state))
          throw problems.invalidTransition(
            `Cannot move stage ${position} from ${existing.state} to ${body.state}.`,
          );
        const enters = (s: WorkflowState) => body.state === s && existing.state !== s;
        const startedAt = existing.started_at ?? (body.state === 'RUNNING' ? observedAt : null);
        const finishedAt =
          body.state === 'COMPLETED' || body.state === 'CANCELLED' || body.state === 'FAILED'
            ? (existing.finished_at ?? observedAt)
            : body.state === 'RETRYING'
              ? null
              : existing.finished_at;
        const errorSummary = enters('FAILED')
          ? (body.errorSummary ?? body.reason ?? null)
          : body.state === 'RETRYING'
            ? null
            : (body.errorSummary ?? existing.error_summary);
        await client.query(
          `UPDATE workflow_stages SET name = $2, state = $3, state_observed_at = $4, state_reason = $5, agent = COALESCE($6, agent),
             started_at = $7, finished_at = $8, error_summary = $9, requires_approval = $10,
             approval_id = COALESCE($11, approval_id), clarification_id = COALESCE($12, clarification_id)
           WHERE id = $1`,
          [
            stageId,
            body.name,
            body.state,
            observedAt,
            body.reason ?? null,
            body.agent ?? null,
            startedAt,
            finishedAt,
            errorSummary,
            body.requiresApproval,
            approvalId,
            clarificationId,
          ],
        );
        if (body.state !== existing.state)
          await client.query(
            `INSERT INTO workflow_transitions (organization_id, workflow_id, stage_id, from_state, to_state, observed_at, reason, principal_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [
              this.principal.organizationId,
              w.id,
              stageId,
              existing.state,
              body.state,
              observedAt,
              body.reason ?? null,
              this.principal.id,
            ],
          );
      }
      await syncWorkflowStagePointer(client, w.id, body.count);
      await this.log(client, 'accepted');
      return { outcome: 'accepted', id: stageId, state: w.state };
    });
  }

  async upsertAgentRun(externalId: string, body: AgentRunUpsert): Promise<IngestResult> {
    return this.run(async (client) => {
      const w = await this.lockWorkflow(client, body.workflowExternalId);
      if (!w) throw problems.notFound(`Unknown workflow ${body.workflowExternalId}.`);
      this.assertScope(w.project_id);
      const stage = await this.requireStage(client, w.id, body.stagePosition);
      await this.assertOwnedBy(client, 'agent_runs', externalId, w.id);
      const timeline = body.timeline.slice(-50);
      const r = await client.query<{ id: string }>(
        `INSERT INTO agent_runs (organization_id, project_id, workflow_id, stage_id, external_id, agent, model, state, started_at, finished_at, summary, timeline)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
         ON CONFLICT (organization_id, external_id) DO UPDATE SET stage_id = EXCLUDED.stage_id, agent = EXCLUDED.agent, model = COALESCE(EXCLUDED.model, agent_runs.model),
           state = EXCLUDED.state, started_at = EXCLUDED.started_at, finished_at = EXCLUDED.finished_at, summary = COALESCE(EXCLUDED.summary, agent_runs.summary), timeline = EXCLUDED.timeline
         RETURNING id`,
        [
          this.principal.organizationId,
          w.project_id,
          w.id,
          stage.id,
          externalId,
          body.agent,
          body.model ?? null,
          body.state,
          new Date(body.startedAt),
          body.finishedAt ? new Date(body.finishedAt) : null,
          body.summary ?? null,
          JSON.stringify(timeline),
        ],
      );
      await this.log(client, 'accepted');
      return { outcome: 'accepted', id: r.rows[0]!.id, state: w.state };
    });
  }

  async upsertArtifact(externalId: string, body: ArtifactUpsert): Promise<IngestResult> {
    return this.run(async (client) => {
      const w = await this.lockWorkflow(client, body.workflowExternalId);
      if (!w) throw problems.notFound(`Unknown workflow ${body.workflowExternalId}.`);
      this.assertScope(w.project_id);
      const stage = await this.requireStage(client, w.id, body.stagePosition);
      await this.assertOwnedBy(client, 'artifacts', externalId, w.id);
      const existing = await client.query<{ id: string; stage_state: WorkflowState }>(
        `SELECT a.id, s.state AS stage_state FROM artifacts a JOIN workflow_stages s ON s.id = a.stage_id
          WHERE a.organization_id = $1 AND a.external_id = $2 FOR UPDATE OF a`,
        [this.principal.organizationId, externalId],
      );
      if (existing.rows[0]?.stage_state === 'COMPLETED') throw problems.artifactImmutable();
      const r = await client.query<{ id: string }>(
        `INSERT INTO artifacts (organization_id, project_id, workflow_id, stage_id, external_id, type, title, href, summary, produced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (organization_id, external_id) DO UPDATE SET stage_id = EXCLUDED.stage_id, type = EXCLUDED.type, title = EXCLUDED.title,
           href = EXCLUDED.href, summary = EXCLUDED.summary, produced_at = EXCLUDED.produced_at
         RETURNING id`,
        [
          this.principal.organizationId,
          w.project_id,
          w.id,
          stage.id,
          externalId,
          body.type,
          body.title,
          body.href ?? null,
          body.summary ?? null,
          new Date(body.producedAt),
        ],
      );
      await this.log(client, 'accepted');
      return { outcome: 'accepted', id: r.rows[0]!.id, state: w.state };
    });
  }

  async upsertTestRun(externalId: string, body: TestRunUpsert): Promise<IngestResult> {
    return this.run(async (client) => {
      const w = await this.lockWorkflow(client, body.workflowExternalId);
      if (!w) throw problems.notFound(`Unknown workflow ${body.workflowExternalId}.`);
      this.assertScope(w.project_id);
      const stage = await this.requireStage(client, w.id, body.stagePosition);
      await this.assertOwnedBy(client, 'test_runs', externalId, w.id);
      const r = await client.query<{ id: string }>(
        `INSERT INTO test_runs (organization_id, project_id, workflow_id, stage_id, external_id, category, status, total, passed, failed, skipped, href, started_at, finished_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (organization_id, external_id) DO UPDATE SET stage_id = EXCLUDED.stage_id, category = EXCLUDED.category, status = EXCLUDED.status,
           total = EXCLUDED.total, passed = EXCLUDED.passed, failed = EXCLUDED.failed, skipped = EXCLUDED.skipped, href = COALESCE(EXCLUDED.href, test_runs.href),
           started_at = EXCLUDED.started_at, finished_at = EXCLUDED.finished_at
         RETURNING id`,
        [
          this.principal.organizationId,
          w.project_id,
          w.id,
          stage.id,
          externalId,
          body.category,
          body.status,
          body.total,
          body.passed,
          body.failed,
          body.skipped,
          body.href ?? null,
          new Date(body.startedAt),
          body.finishedAt ? new Date(body.finishedAt) : null,
        ],
      );
      await this.log(client, 'accepted');
      return { outcome: 'accepted', id: r.rows[0]!.id, state: w.state };
    });
  }

  async upsertClarification(externalId: string, body: ClarificationUpsert): Promise<IngestResult> {
    return this.run(async (client) => {
      const w = await this.lockWorkflow(client, body.workflowExternalId);
      if (!w) throw problems.notFound(`Unknown workflow ${body.workflowExternalId}.`);
      this.assertScope(w.project_id);
      if (!body.answer) await this.assertNoOtherPending(client, w.id, 'clarifications', externalId);
      const r = await client.query<{ id: string }>(
        `INSERT INTO clarifications (organization_id, project_id, workflow_id, external_id, question, requested_by_agent, requested_at, has_recommended_answer, answered_at, answered_by, why_it_matters, options, links)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (organization_id, external_id) DO UPDATE SET question = EXCLUDED.question, requested_by_agent = COALESCE(EXCLUDED.requested_by_agent, clarifications.requested_by_agent),
           has_recommended_answer = EXCLUDED.has_recommended_answer, answered_at = COALESCE(EXCLUDED.answered_at, clarifications.answered_at), answered_by = COALESCE(EXCLUDED.answered_by, clarifications.answered_by),
           why_it_matters = COALESCE(EXCLUDED.why_it_matters, clarifications.why_it_matters), options = EXCLUDED.options, links = EXCLUDED.links
         RETURNING id`,
        [
          this.principal.organizationId,
          w.project_id,
          w.id,
          externalId,
          body.question,
          body.requestedByAgent ?? null,
          new Date(body.requestedAt),
          body.hasRecommendedAnswer,
          body.answer ? new Date(body.answer.answeredAt) : null,
          body.answer?.answeredBy ?? null,
          body.whyItMatters ?? null,
          JSON.stringify(body.options ?? []),
          JSON.stringify(body.links ?? {}),
        ],
      );
      await this.log(client, 'accepted');
      return { outcome: 'accepted', id: r.rows[0]!.id, state: w.state };
    });
  }
}
