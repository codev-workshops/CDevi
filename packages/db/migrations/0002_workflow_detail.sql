-- specs/001-sdlc-control-plane-mvp data-model.md §2–§4 (User Story 1: Workflow Detail).
-- Adds the per-stage journey behind /workflows/{id}: stages, agent runs, artifacts and test-run summaries.
-- Run as `migrator`. Every table carries organization_id and project_id; RLS policies follow 0001_init.sql.

CREATE TYPE artifact_type AS ENUM ('requirement_spec','impact_analysis','implementation_plan','test_results','code_diff','pull_request');
CREATE TYPE test_run_status AS ENUM ('RUNNING','PASSED','FAILED');

CREATE TABLE workflow_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  position smallint NOT NULL CHECK (position BETWEEN 1 AND 20),
  name text NOT NULL CHECK (char_length(name) <= 60),
  state workflow_state NOT NULL,
  state_observed_at timestamptz NOT NULL,
  state_reason text CHECK (char_length(state_reason) <= 240),
  agent text CHECK (char_length(agent) <= 80),
  started_at timestamptz,
  finished_at timestamptz,
  error_summary text CHECK (char_length(error_summary) <= 400),
  requires_approval boolean NOT NULL DEFAULT false,
  approval_id uuid REFERENCES approvals(id) ON DELETE SET NULL,
  clarification_id uuid REFERENCES clarifications(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflow_stages_workflow_position_key UNIQUE (workflow_id, position)
);
CREATE INDEX workflow_stages_workflow_idx ON workflow_stages (workflow_id, position);
CREATE INDEX workflow_stages_attention_idx ON workflow_stages (organization_id, workflow_id) WHERE state IN ('WAITING_FOR_HUMAN','BLOCKED','FAILED');

CREATE TABLE agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  stage_id uuid NOT NULL REFERENCES workflow_stages(id) ON DELETE CASCADE,
  external_id text NOT NULL,
  agent text NOT NULL CHECK (char_length(agent) <= 80),
  model text CHECK (char_length(model) <= 80),
  state workflow_state NOT NULL CHECK (state <> 'QUEUED'),
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  summary text CHECK (char_length(summary) <= 400),
  timeline jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(timeline) = 'array' AND jsonb_array_length(timeline) <= 50),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, external_id)
);
CREATE INDEX agent_runs_workflow_idx ON agent_runs (workflow_id, started_at);
CREATE INDEX agent_runs_stage_idx ON agent_runs (stage_id, started_at DESC);

CREATE TABLE artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  stage_id uuid NOT NULL REFERENCES workflow_stages(id) ON DELETE CASCADE,
  external_id text NOT NULL,
  type artifact_type NOT NULL,
  title text NOT NULL CHECK (char_length(title) <= 200),
  href text CHECK (char_length(href) <= 500),
  summary text CHECK (char_length(summary) <= 400),
  produced_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, external_id)
);
CREATE INDEX artifacts_workflow_idx ON artifacts (workflow_id, produced_at);

CREATE TABLE test_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  stage_id uuid NOT NULL REFERENCES workflow_stages(id) ON DELETE CASCADE,
  external_id text NOT NULL,
  category text NOT NULL CHECK (char_length(category) <= 40),
  status test_run_status NOT NULL,
  total integer NOT NULL DEFAULT 0 CHECK (total >= 0),
  passed integer NOT NULL DEFAULT 0 CHECK (passed >= 0),
  failed integer NOT NULL DEFAULT 0 CHECK (failed >= 0),
  skipped integer NOT NULL DEFAULT 0 CHECK (skipped >= 0),
  href text CHECK (char_length(href) <= 500),
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, external_id),
  CONSTRAINT test_runs_counts_check CHECK (passed + failed + skipped <= total)
);
CREATE INDEX test_runs_workflow_idx ON test_runs (workflow_id, started_at);

-- Transitions now know which stage moved and which user (retry/escalate/cancel) caused it.
ALTER TABLE workflow_transitions
  ADD COLUMN stage_id uuid REFERENCES workflow_stages(id) ON DELETE CASCADE,
  ADD COLUMN user_id uuid REFERENCES users(id);
CREATE INDEX workflow_transitions_stage_idx ON workflow_transitions (stage_id, observed_at);

-- updated_at maintenance
CREATE TRIGGER workflow_stages_updated_at BEFORE UPDATE ON workflow_stages FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER agent_runs_updated_at BEFORE UPDATE ON agent_runs FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER test_runs_updated_at BEFORE UPDATE ON test_runs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Artifacts are immutable once their producing stage has completed (spec Key Entities: Artifact).
CREATE FUNCTION artifacts_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM workflow_stages s WHERE s.id = OLD.stage_id AND s.state = 'COMPLETED') THEN
    RAISE EXCEPTION 'artifact_immutable' USING ERRCODE = 'P0001', HINT = 'producing stage has completed';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER artifacts_immutable BEFORE UPDATE ON artifacts FOR EACH ROW EXECUTE FUNCTION artifacts_immutable();

-- Every change to the journey reaches open Workflow Detail pages through the existing inbox change log.
CREATE TRIGGER inbox_changed_workflow_stages AFTER INSERT OR UPDATE ON workflow_stages FOR EACH ROW EXECUTE FUNCTION notify_inbox_changed();
CREATE TRIGGER inbox_changed_agent_runs AFTER INSERT OR UPDATE ON agent_runs FOR EACH ROW EXECUTE FUNCTION notify_inbox_changed();
CREATE TRIGGER inbox_changed_artifacts AFTER INSERT OR UPDATE ON artifacts FOR EACH ROW EXECUTE FUNCTION notify_inbox_changed();
CREATE TRIGGER inbox_changed_test_runs AFTER INSERT OR UPDATE ON test_runs FOR EACH ROW EXECUTE FUNCTION notify_inbox_changed();

-- Row-level security policies (enabled by flag — architecture §6).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['workflow_stages','agent_runs','artifacts','test_runs'] LOOP
    EXECUTE format('CREATE POLICY %I_org_isolation ON %I USING (organization_id = current_setting(''app.organization_id'', true)::uuid)', t, t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON workflow_stages, agent_runs, artifacts, test_runs TO app_user;
