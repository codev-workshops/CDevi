-- specs/001 US4 (Part D, data-model.md §22, research R32–R40): requirements, analysis items, transitions,
-- Jira project mappings; workflows.requirement_id; inbox_change_log.requirement_id. RLS and grants follow 0001–0003.

CREATE TYPE requirement_state  AS ENUM ('DRAFT','ANALYZING','NEEDS_CLARIFICATION','READY','APPROVED','IN_IMPLEMENTATION','COMPLETED','REJECTED');
CREATE TYPE requirement_source AS ENUM ('manual','jira');
CREATE TYPE analysis_item_kind AS ENUM ('acceptance_criterion','rule','open_question');
CREATE TYPE external_flag      AS ENUM ('deleted','closed');

-- §22.1 integration_project_mappings: Jira project key → CDevi project (R36). One key resolves to one project.
CREATE TABLE integration_project_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('jira')),
  external_project_key text NOT NULL CHECK (external_project_key ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  external_base_url text NOT NULL CHECK (external_base_url ~ '^https://' AND char_length(external_base_url) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integration_project_mappings_provider_external_project_key_key UNIQUE (provider, external_project_key),
  CONSTRAINT integration_project_mappings_project_provider_key UNIQUE (organization_id, project_id, provider)
);

-- §22.2 requirements (R32, R34)
CREATE TABLE requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  external_id text NOT NULL CHECK (external_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 200),
  business_objective text NOT NULL CHECK (char_length(business_objective) BETWEEN 10 AND 4000),
  state requirement_state NOT NULL DEFAULT 'DRAFT',
  source requirement_source NOT NULL DEFAULT 'manual',
  external_ref jsonb,                                   -- { provider:'jira', key, url, updatedAt } (R36)
  external_flag external_flag,
  external_flagged_at timestamptz,
  created_by_user_id uuid REFERENCES users(id),         -- NULL for Jira-created rows
  assignee_user_id uuid REFERENCES users(id),
  submitted_by_user_id uuid REFERENCES users(id),
  submitted_at timestamptz,
  analysis_observed_at timestamptz,                     -- idempotency watermark for the analysis ingest (R35)
  analysis_agent text CHECK (char_length(analysis_agent) <= 80),
  analysis_summary text CHECK (char_length(analysis_summary) <= 400),  -- AI-generated (labelled)
  approved_by_user_id uuid REFERENCES users(id),
  approved_at timestamptz,
  rejected_by_user_id uuid REFERENCES users(id),
  rejected_at timestamptz,
  rejection_reason text CHECK (char_length(rejection_reason) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, external_id),
  CONSTRAINT requirements_external_ref_check CHECK (
    (source = 'manual' AND external_ref IS NULL) OR
    (source = 'jira' AND external_ref IS NOT NULL AND external_ref ? 'key' AND external_ref ? 'url')),   -- IS NOT NULL: NULL ? 'key' is NULL, which a CHECK would let through
  CONSTRAINT requirements_flag_check CHECK ((external_flag IS NULL) = (external_flagged_at IS NULL))
);
CREATE UNIQUE INDEX requirements_jira_key_idx ON requirements (organization_id, (external_ref->>'key')) WHERE source = 'jira';
CREATE INDEX requirements_list_idx     ON requirements (organization_id, project_id, created_at DESC, id DESC);
CREATE INDEX requirements_state_idx    ON requirements (organization_id, state, created_at DESC, id DESC);   -- full: the state filter accepts terminal states too (§23.3)
CREATE INDEX requirements_assignee_idx ON requirements (organization_id, assignee_user_id, created_at DESC, id DESC) WHERE assignee_user_id IS NOT NULL;
CREATE TRIGGER requirements_updated_at BEFORE UPDATE ON requirements FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- §22.3 requirement_analysis_items: one row per criterion / rule / open question (R34).
-- Human-authored items (create form) and AI items (analysis ingest) have DISJOINT position spaces:
-- the unique key includes ai_generated, so an authored criterion and an AI criterion may both be position 1.
CREATE TABLE requirement_analysis_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  requirement_id uuid NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  kind analysis_item_kind NOT NULL,
  position smallint NOT NULL CHECK (position BETWEEN 1 AND 50),
  text text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 1000),
  ai_generated boolean NOT NULL,
  source text NOT NULL CHECK (char_length(source) <= 120),   -- 'user:<display name>' | 'agent:<agent>'
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT requirement_analysis_items_position_key UNIQUE (requirement_id, kind, ai_generated, position),
  CONSTRAINT requirement_analysis_items_human_check CHECK (ai_generated OR (kind = 'acceptance_criterion' AND position <= 20))   -- humans author ≤ 20 criteria only (R45)
);
CREATE INDEX requirement_analysis_items_req_idx ON requirement_analysis_items (requirement_id, kind, ai_generated, position);

-- §22.4 requirement_transitions: append-only history (R32), mirrors workflow_transitions
CREATE TABLE requirement_transitions (
  id bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  requirement_id uuid NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  from_state requirement_state,                          -- NULL on creation
  to_state requirement_state NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('user','agent','system')),
  actor_id text,
  actor_name text NOT NULL CHECK (char_length(actor_name) <= 120),
  reason text CHECK (char_length(reason) <= 500),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX requirement_transitions_req_idx ON requirement_transitions (requirement_id, occurred_at);
CREATE FUNCTION requirement_transitions_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'requirement_transitions is append-only' USING ERRCODE = 'P0001';
END $$;
CREATE TRIGGER requirement_transitions_append_only BEFORE UPDATE OR DELETE ON requirement_transitions
  FOR EACH ROW EXECUTE FUNCTION requirement_transitions_append_only();

-- §22.5 workflows.requirement_id — one workflow per requirement in US4 (R37)
ALTER TABLE workflows ADD COLUMN requirement_id uuid REFERENCES requirements(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX workflows_requirement_idx ON workflows (requirement_id) WHERE requirement_id IS NOT NULL;
CREATE INDEX workflows_list_idx ON workflows (organization_id, state_observed_at DESC, id DESC);   -- GET /workflows keyset (R38)

-- §22.6 Approved → In Implementation → Completed follows the linked workflow (R33)
CREATE FUNCTION requirements_follow_workflow() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_state requirement_state; v_next requirement_state;
BEGIN
  SELECT state INTO v_state FROM requirements WHERE id = NEW.requirement_id FOR UPDATE;
  IF v_state IS NULL THEN RETURN NEW; END IF;
  IF NEW.state = 'COMPLETED' AND v_state IN ('APPROVED','IN_IMPLEMENTATION') THEN v_next := 'COMPLETED';
  ELSIF v_state = 'APPROVED' AND NEW.state NOT IN ('QUEUED','CANCELLED','BLOCKED') THEN v_next := 'IN_IMPLEMENTATION';
  ELSE RETURN NEW; END IF;
  UPDATE requirements SET state = v_next WHERE id = NEW.requirement_id;
  INSERT INTO requirement_transitions (organization_id, requirement_id, from_state, to_state, actor_type, actor_name, reason, occurred_at)
    VALUES (NEW.organization_id, NEW.requirement_id, v_state, v_next, 'system', 'workflow', 'workflow ' || NEW.external_id || ' → ' || NEW.state, NEW.state_observed_at);
  RETURN NEW;
END $$;
CREATE TRIGGER workflows_follow_requirement AFTER UPDATE OF state ON workflows FOR EACH ROW
  WHEN (NEW.requirement_id IS NOT NULL AND OLD.state IS DISTINCT FROM NEW.state) EXECUTE FUNCTION requirements_follow_workflow();

-- §22.7 live updates: requirement changes ride inbox_changed (R40). ONE trigger, on requirements only:
-- requirement_analysis_items has no trigger — every write to it (create form, analysis ingest) happens in a
-- transaction that also INSERTs/UPDATEs the parent requirements row, which is the single NOTIFY per transaction.
ALTER TABLE inbox_change_log ALTER COLUMN workflow_id DROP NOT NULL, ADD COLUMN requirement_id uuid;
ALTER TABLE inbox_change_log ADD CONSTRAINT inbox_change_log_target_check CHECK (workflow_id IS NOT NULL OR requirement_id IS NOT NULL);
CREATE FUNCTION notify_requirement_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_seq bigint;
BEGIN
  INSERT INTO inbox_change_log (organization_id, project_id, workflow_id, requirement_id)
    VALUES (NEW.organization_id, NEW.project_id, NULL, NEW.id) RETURNING seq INTO v_seq;
  PERFORM pg_notify('inbox_changed', json_build_object('seq', v_seq, 'organizationId', NEW.organization_id,
    'projectId', NEW.project_id, 'workflowId', NULL, 'requirementId', NEW.id)::text);
  RETURN NULL;
END $$;
CREATE TRIGGER inbox_changed_requirements AFTER INSERT OR UPDATE ON requirements FOR EACH ROW EXECUTE FUNCTION notify_requirement_changed();

-- §22.8 RLS policies (same shape as 0001; ENABLE/DISABLE is NOT done here — the CDEVI_RLS loop in
-- packages/db/src/migrate.ts owns it for every table in RLS_TABLES, which gains these four names) and grants
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['integration_project_mappings','requirements','requirement_analysis_items','requirement_transitions'] LOOP
    EXECUTE format('CREATE POLICY %I_org_isolation ON %I USING (organization_id = current_setting(''app.organization_id'', true)::uuid)', t, t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON requirements, requirement_analysis_items TO app_user;
GRANT SELECT ON integration_project_mappings TO app_user;          -- mappings are seeded/administered (US8), never written by US4 routes
GRANT SELECT, INSERT ON requirement_transitions TO app_user;      -- append-only
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
