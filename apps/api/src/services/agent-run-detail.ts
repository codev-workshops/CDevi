/**
 * Agent-run detail read service (specs/001 US5, FR-016/FR-017/FR-018). Three statements inside one
 * REPEATABLE READ transaction: the caller's visible projects, the run joined to its workflow and stage,
 * and the run's decisions in position order. An unknown run and a run in an invisible project both
 * resolve to `null`, so the route cannot tell them apart (FR-032).
 */
import type {
  AgentDecision,
  AgentRunDetail,
  AgentRunEvent,
  ConfidenceLevel,
  EvidenceRef,
  PolicyOutcome,
  RiskLevel,
  RunStep,
  WorkflowState,
} from '@cdevi/contracts';
import { runDuration } from '@cdevi/contracts/agent-run-model';
import type pg from 'pg';
import { visibleProjects, type SessionUser } from './auth';

interface RunHead {
  id: string;
  external_id: string;
  agent: string;
  model: string | null;
  state: WorkflowState;
  started_at: Date;
  finished_at: Date | null;
  summary: string | null;
  steps: RunStep[];
  timeline: AgentRunEvent[];
  workflow_id: string;
  workflow_external_id: string;
  workflow_title: string;
  stage_position: number;
  stage_name: string;
}

interface DecisionRow {
  id: string;
  position: number;
  decided_at: Date;
  action: string;
  reason: string;
  confidence: ConfidenceLevel;
  policy_outcome: PolicyOutcome;
  policy_ref: string | null;
  risk_level: RiskLevel | null;
  evidence: EvidenceRef[];
}

export async function getAgentRunDetail(
  client: pg.PoolClient,
  user: SessionUser,
  id: string,
  now: Date,
): Promise<AgentRunDetail | null> {
  const projectIds = (await visibleProjects(client, user)).map((p) => p.id);
  if (projectIds.length === 0) return null;

  const run = (
    await client.query<RunHead>(
      `SELECT r.id, r.external_id, r.agent, r.model, r.state, r.started_at, r.finished_at, r.summary, r.steps, r.timeline,
              w.id AS workflow_id, w.external_id AS workflow_external_id, w.title AS workflow_title,
              s.position AS stage_position, s.name AS stage_name
         FROM agent_runs r
         JOIN workflows w ON w.id = r.workflow_id
         JOIN workflow_stages s ON s.id = r.stage_id
        WHERE r.id = $1 AND r.organization_id = $2 AND r.project_id = ANY($3::uuid[])`,
      [id, user.organizationId, projectIds],
    )
  ).rows[0];
  if (!run) return null;

  const decisions = (
    await client.query<DecisionRow>(
      `SELECT id, position, decided_at, action, reason, confidence, policy_outcome, policy_ref, risk_level, evidence
         FROM agent_decisions WHERE agent_run_id = $1 ORDER BY position LIMIT 50`,
      [run.id],
    )
  ).rows.map<AgentDecision>((d) => ({
    id: d.id,
    position: d.position,
    decidedAt: d.decided_at.toISOString(),
    action: d.action,
    reason: d.reason,
    confidence: d.confidence,
    policyOutcome: d.policy_outcome,
    policyRef: d.policy_ref,
    riskLevel: d.risk_level,
    evidence: d.evidence,
  }));

  return {
    id: run.id,
    externalId: run.external_id,
    agent: run.agent,
    model: run.model,
    state: run.state,
    startedAt: run.started_at.toISOString(),
    finishedAt: run.finished_at?.toISOString() ?? null,
    durationMs: runDuration(run.started_at, run.finished_at, now),
    summary: run.summary,
    workflow: { id: run.workflow_id, externalId: run.workflow_external_id, title: run.workflow_title },
    stage: { position: run.stage_position, name: run.stage_name },
    steps: run.steps.slice(0, 20),
    timeline: run.timeline.slice(-50),
    decisions,
  };
}
