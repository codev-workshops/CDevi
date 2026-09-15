-- specs/001 US5 "Inspect an agent run and its decisions" (data-model.md §31–§37): agent_runs.steps (structured
-- progress, AS-3) and the agent_decisions table (FR-017, FR-018). Decisions are delivered whole by the runtime
-- (PUT /api/ingest/agent-runs/{externalId}/decisions → DELETE + batch INSERT); the read model is GET /api/agent-runs/{id}.
-- RLS and grants follow 0001–0005: policies are written here, ENABLE/DISABLE is owned by the CDEVI_RLS loop in
-- packages/db/src/migrate.ts (RLS_TABLES gains agent_decisions).

-- §31 vocabulary
CREATE TYPE confidence_level AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE policy_outcome AS ENUM ('ALLOWED', 'APPROVAL_REQUIRED', 'DENIED');

-- §32 structured progress on the run: ≤ 20 { label ≤ 120, status: completed|running|pending|failed }, runtime-provided.
ALTER TABLE agent_runs
  ADD COLUMN steps jsonb NOT NULL DEFAULT '[]'::jsonb
    CONSTRAINT agent_runs_steps_check CHECK (jsonb_typeof(steps) = 'array' AND jsonb_array_length(steps) <= 20);

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

-- §34 live updates (FR-004/FR-034). Replace-whole ingestion inserts up to 50 rows in one statement, so the
-- trigger is statement-level over the transition table: one inbox_change_log row and one NOTIFY per
-- (organization, project, workflow) touched — never one frame per decision. The payload shape is the one
-- notify_inbox_changed() emits, so the SSE fan-out and the client filter by workflowId are unchanged.
CREATE FUNCTION notify_agent_decision_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record; v_seq bigint;
BEGIN
  FOR r IN SELECT DISTINCT organization_id, project_id, workflow_id FROM inserted LOOP
    INSERT INTO inbox_change_log (organization_id, project_id, workflow_id)
      VALUES (r.organization_id, r.project_id, r.workflow_id) RETURNING seq INTO v_seq;
    PERFORM pg_notify('inbox_changed', json_build_object('seq', v_seq, 'organizationId', r.organization_id,
      'projectId', r.project_id, 'workflowId', r.workflow_id)::text);
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER inbox_changed_agent_decisions AFTER INSERT ON agent_decisions
  REFERENCING NEW TABLE AS inserted FOR EACH STATEMENT EXECUTE FUNCTION notify_agent_decision_changed();

-- §35 RLS policy (same shape as 0001–0005; not enabled here) and grants: replace-whole ingestion needs
-- SELECT, INSERT and DELETE; decisions are never edited in place.
CREATE POLICY agent_decisions_org_isolation ON agent_decisions
  USING (organization_id = current_setting('app.organization_id', true)::uuid);
GRANT SELECT, INSERT, DELETE ON agent_decisions TO app_user;
