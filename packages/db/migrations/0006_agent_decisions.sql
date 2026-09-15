-- specs/001 US5 "Inspect an agent run and its decisions" (data-model.md §31–§37): agent_runs.steps (structured
-- progress, AS-3) and the agent_decisions table (FR-017, FR-018). Decisions are delivered whole by the runtime
-- (PUT /api/ingest/agent-runs/{externalId}/decisions → DELETE + batch INSERT); the read model is GET /api/agent-runs/{id}.
-- RLS and grants follow 0001–0005: policies are written here, ENABLE/DISABLE is owned by the CDEVI_RLS loop in
-- packages/db/src/migrate.ts (RLS_TABLES gains agent_decisions).

-- §31 vocabulary
CREATE TYPE confidence_level AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE policy_outcome AS ENUM ('ALLOWED', 'APPROVAL_REQUIRED', 'DENIED');

-- §32 structured progress on the run: ≤ 20 { label ≤ 120, status: completed|running|pending|failed }, runtime-provided.
-- decisions_observed_at is the replace-whole watermark of PUT …/decisions (same idea as
-- requirements.analysis_observed_at in 0005): NULL until the first batch; a batch whose observedAt is not newer is `stale`.
ALTER TABLE agent_runs
  ADD COLUMN steps jsonb NOT NULL DEFAULT '[]'::jsonb
    CONSTRAINT agent_runs_steps_check CHECK (jsonb_typeof(steps) = 'array' AND jsonb_array_length(steps) <= 20),
  ADD COLUMN decisions_observed_at timestamptz;

-- §33 one row per reported decision; `reason` is a bounded summary, never chain-of-thought (FR-018).
-- risk_level is optional until US8 makes it mandatory. evidence is ≤ 20 typed refs
-- { kind, label ≤ 200, href?, locator? ≤ 200, accessible } validated by the contract.
CREATE TABLE agent_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  stage_id uuid NOT NULL REFERENCES workflow_stages(id) ON DELETE CASCADE,
  agent_run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  position smallint NOT NULL CHECK (position BETWEEN 1 AND 50),
  decided_at timestamptz NOT NULL,
  action text NOT NULL CHECK (char_length(action) <= 200),
  reason text NOT NULL CHECK (char_length(reason) <= 600),
  confidence confidence_level NOT NULL,
  policy_outcome policy_outcome NOT NULL,
  policy_ref text CHECK (char_length(policy_ref) <= 120),
  risk_level risk_level,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence) = 'array' AND jsonb_array_length(evidence) <= 20),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_decisions_run_position_key UNIQUE (agent_run_id, position)
);
CREATE INDEX agent_decisions_run_idx ON agent_decisions (agent_run_id, position);

-- §34 live updates (FR-004/FR-034). Replace-whole ingestion is DELETE + one batch INSERT of up to 50 rows, so the
-- triggers are statement-level over the transition tables (one trigger per event — Postgres does not allow a
-- transition table on a multi-event trigger) and de-duplicated per transaction with a transaction-local setting:
-- one inbox_change_log row and one NOTIFY per (organization, project, workflow) touched — never one frame per
-- decision, and still exactly one when the replacement is empty (DELETE only). A cascading DELETE from a workflow
-- that is itself being removed notifies nothing. The payload shape is the one notify_inbox_changed() emits, so the
-- SSE fan-out and the client filter by workflowId are unchanged.
CREATE FUNCTION notify_agent_decision_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record; v_seq bigint; v_key text;
BEGIN
  FOR r IN EXECUTE format(
    'SELECT DISTINCT d.organization_id, d.project_id, d.workflow_id FROM %I d
     WHERE EXISTS (SELECT 1 FROM workflows w WHERE w.id = d.workflow_id)',
    CASE TG_OP WHEN 'INSERT' THEN 'inserted' ELSE 'deleted' END)
  LOOP
    v_key := 'cdevi.decisions_notified_' || replace(r.workflow_id::text, '-', '');
    CONTINUE WHEN coalesce(current_setting(v_key, true), '') = '1';
    PERFORM set_config(v_key, '1', true);
    INSERT INTO inbox_change_log (organization_id, project_id, workflow_id)
      VALUES (r.organization_id, r.project_id, r.workflow_id) RETURNING seq INTO v_seq;
    PERFORM pg_notify('inbox_changed', json_build_object('seq', v_seq, 'organizationId', r.organization_id,
      'projectId', r.project_id, 'workflowId', r.workflow_id)::text);
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER inbox_changed_agent_decisions AFTER INSERT ON agent_decisions
  REFERENCING NEW TABLE AS inserted FOR EACH STATEMENT EXECUTE FUNCTION notify_agent_decision_changed();
CREATE TRIGGER inbox_changed_agent_decisions_deleted AFTER DELETE ON agent_decisions
  REFERENCING OLD TABLE AS deleted FOR EACH STATEMENT EXECUTE FUNCTION notify_agent_decision_changed();

-- §35 RLS policy (same shape as 0001–0005; not enabled here) and grants: replace-whole ingestion needs
-- SELECT, INSERT and DELETE; decisions are never edited in place.
CREATE POLICY agent_decisions_org_isolation ON agent_decisions
  USING (organization_id = current_setting('app.organization_id', true)::uuid);
GRANT SELECT, INSERT, DELETE ON agent_decisions TO app_user;
