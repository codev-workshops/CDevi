-- specs/003-inbox-home data-model.md §2 — first persisted CDevi records.
-- Run as `migrator`. Every table carries organization_id; RLS policies are written here and enabled only when
-- CDEVI_RLS=on (packages/db/src/migrate.ts), per docs/architecture.md §6.

CREATE EXTENSION IF NOT EXISTS citext;

CREATE TYPE workflow_state AS ENUM ('QUEUED','RUNNING','RETRYING','WAITING','WAITING_FOR_HUMAN','BLOCKED','FAILED','COMPLETED','CANCELLED');
CREATE TYPE risk_level AS ENUM ('LOW','MEDIUM','HIGH','CRITICAL');
CREATE TYPE user_role AS ENUM ('administrator','approver','engineer','viewer');
CREATE TYPE approval_decision AS ENUM ('approved','rejected');
CREATE TYPE ingestion_outcome AS ENUM ('accepted','stale','rejected','forbidden');

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid GENERATED ALWAYS AS (id) STORED,
  name text NOT NULL,
  timezone text NOT NULL DEFAULT 'UTC',
  policy_summary text NOT NULL DEFAULT 'Pull request merges and all HIGH/CRITICAL actions require human approval.',
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  key text NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, key)
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  email citext NOT NULL,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  role user_role NOT NULL,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, email)
);

CREATE TABLE project_memberships (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, project_id)
);

CREATE TABLE sessions (
  id_hash bytea PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE ingestion_principals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  token_hash bytea NOT NULL UNIQUE,
  project_ids uuid[] NOT NULL DEFAULT '{}',
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  external_id text NOT NULL,
  title text NOT NULL CHECK (char_length(title) <= 200),
  agent text,
  state workflow_state NOT NULL,
  state_observed_at timestamptz NOT NULL,
  state_reason text,
  stage_index smallint,
  stage_count smallint DEFAULT 7,
  stage_name text,
  pull_request_ref text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflows_org_external_id_key UNIQUE (organization_id, external_id)
);
CREATE INDEX workflows_org_project_state_idx ON workflows (organization_id, project_id, state);
CREATE INDEX workflows_needs_you_idx ON workflows (organization_id, state_observed_at) WHERE state IN ('WAITING_FOR_HUMAN','BLOCKED','FAILED');
CREATE INDEX workflows_running_idx ON workflows (organization_id, started_at DESC) WHERE state IN ('QUEUED','RUNNING','RETRYING','WAITING');
CREATE INDEX workflows_done_idx ON workflows (organization_id, finished_at DESC) WHERE state IN ('COMPLETED','CANCELLED');

CREATE TABLE workflow_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  from_state workflow_state,
  to_state workflow_state NOT NULL,
  observed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  reason text,
  principal_id uuid REFERENCES ingestion_principals(id)
);
CREATE INDEX workflow_transitions_workflow_idx ON workflow_transitions (workflow_id, observed_at);

CREATE TABLE approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  external_id text NOT NULL,
  ask text NOT NULL CHECK (char_length(ask) <= 240),
  risk_level risk_level NOT NULL,
  requested_by_agent text,
  requested_at timestamptz NOT NULL,
  expires_at timestamptz,
  decision approval_decision,
  decided_at timestamptz,
  decided_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, external_id)
);
CREATE INDEX approvals_pending_idx ON approvals (organization_id, workflow_id) WHERE decision IS NULL;
CREATE INDEX approvals_decided_idx ON approvals (organization_id, decided_at) WHERE decided_at IS NOT NULL;

CREATE TABLE clarifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  external_id text NOT NULL,
  question text NOT NULL CHECK (char_length(question) <= 240),
  requested_by_agent text,
  requested_at timestamptz NOT NULL,
  has_recommended_answer boolean NOT NULL DEFAULT false,
  answered_at timestamptz,
  answered_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, external_id)
);
CREATE INDEX clarifications_pending_idx ON clarifications (organization_id, workflow_id) WHERE answered_at IS NULL;

CREATE TABLE ingestion_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  principal_id uuid REFERENCES ingestion_principals(id),
  received_at timestamptz NOT NULL DEFAULT now(),
  route text NOT NULL,
  target_external_id text,
  outcome ingestion_outcome NOT NULL,
  detail text
);

CREATE TABLE inbox_change_log (
  seq bigserial PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  workflow_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inbox_change_log_occurred_idx ON inbox_change_log (occurred_at);

-- updated_at maintenance
CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
CREATE TRIGGER workflows_updated_at BEFORE UPDATE ON workflows FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER approvals_updated_at BEFORE UPDATE ON approvals FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER clarifications_updated_at BEFORE UPDATE ON clarifications FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Inbox change notification (research R6): durable row for replay + NOTIFY for liveness.
CREATE FUNCTION notify_inbox_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_workflow_id uuid;
  v_seq bigint;
BEGIN
  IF TG_TABLE_NAME = 'workflows' THEN v_workflow_id := NEW.id; ELSE v_workflow_id := NEW.workflow_id; END IF;
  INSERT INTO inbox_change_log (organization_id, project_id, workflow_id)
    VALUES (NEW.organization_id, NEW.project_id, v_workflow_id) RETURNING seq INTO v_seq;
  PERFORM pg_notify('inbox_changed', json_build_object(
    'seq', v_seq, 'organizationId', NEW.organization_id, 'projectId', NEW.project_id, 'workflowId', v_workflow_id)::text);
  RETURN NEW;
END $$;
CREATE TRIGGER inbox_changed_workflows AFTER INSERT OR UPDATE ON workflows FOR EACH ROW EXECUTE FUNCTION notify_inbox_changed();
CREATE TRIGGER inbox_changed_approvals AFTER INSERT OR UPDATE ON approvals FOR EACH ROW EXECUTE FUNCTION notify_inbox_changed();
CREATE TRIGGER inbox_changed_clarifications AFTER INSERT OR UPDATE ON clarifications FOR EACH ROW EXECUTE FUNCTION notify_inbox_changed();

-- Row-level security policies (written now, enabled by flag — architecture §6).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['organizations','projects','users','project_memberships','sessions','ingestion_principals','workflows','workflow_transitions','approvals','clarifications','ingestion_log','inbox_change_log'] LOOP
    EXECUTE format('CREATE POLICY %I_org_isolation ON %I USING (organization_id = current_setting(''app.organization_id'', true)::uuid)', t, t);
  END LOOP;
END $$;

-- Grants for the application role. Transitions and the ingestion log are append-only.
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON organizations, projects, users, project_memberships, sessions, ingestion_principals, workflows, approvals, clarifications, inbox_change_log TO app_user;
GRANT SELECT, INSERT ON workflow_transitions, ingestion_log TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
