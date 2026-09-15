-- specs/001 US6 "Review AI findings on a pull request and drive the fix loop" (FR-020, FR-021, FR-022; FR-032 roles,
-- FR-034 live propagation, FR-036 runtime ingestion). One pull request per workflow in the MVP; the runtime reports
-- the pull request, each AI review (seven lanes + ≤ 50 findings, replace-whole) and each fix cycle through
-- PUT /api/ingest/pull-requests/{externalId}[/reviews/{cycle}|/cycles/{cycle}]; humans dismiss / apply fix /
-- request an issue through POST /api/reviews/{pullRequestId}/findings/{findingId}/{dismiss|fix|issue}.
-- ready_for_merge is DERIVED in the read model (no BLOCKING finding OPEN or FIX_REQUESTED) and never stored.
-- RLS and grants follow 0001–0006: policies are written here, ENABLE/DISABLE is owned by the CDEVI_RLS loop in
-- packages/db/src/migrate.ts (RLS_TABLES gains the four tables).

-- Vocabulary
CREATE TYPE review_lane AS ENUM ('correctness', 'security', 'dependencies', 'edge_cases', 'testing', 'architecture', 'general');
CREATE TYPE lane_status AS ENUM ('PASS', 'WARN', 'FAIL');
CREATE TYPE review_status AS ENUM ('RUNNING', 'COMPLETE', 'FAILED');
CREATE TYPE finding_severity AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO');
CREATE TYPE finding_blocking AS ENUM ('BLOCKING', 'NON_BLOCKING', 'SUGGESTION');
CREATE TYPE finding_state AS ENUM ('OPEN', 'FIX_REQUESTED', 'FIXED', 'DISMISSED', 'ISSUE_REQUESTED');
CREATE TYPE review_cycle_state AS ENUM ('RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');
CREATE TYPE pull_request_status AS ENUM ('OPEN', 'MERGED', 'CLOSED');

-- pull_requests: one per workflow (workflow_id UNIQUE), externally identified, optional requirement link.
-- observed_at is the idempotency watermark of PUT /ingest/pull-requests/{externalId} (same idea as workflows.state_observed_at).
CREATE TABLE pull_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL UNIQUE REFERENCES workflows(id) ON DELETE CASCADE,
  requirement_id uuid REFERENCES requirements(id) ON DELETE SET NULL,
  external_id text NOT NULL CHECK (external_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  number integer NOT NULL CHECK (number >= 1),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  href text NOT NULL CHECK (href ~ '^https?://' AND char_length(href) <= 500),
  status pull_request_status NOT NULL DEFAULT 'OPEN',
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, external_id)
);
CREATE INDEX pull_requests_list_idx ON pull_requests (organization_id, project_id, updated_at DESC, id DESC);   -- GET /reviews keyset
CREATE INDEX pull_requests_requirement_idx ON pull_requests (requirement_id) WHERE requirement_id IS NOT NULL;
CREATE TRIGGER pull_requests_updated_at BEFORE UPDATE ON pull_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- review_cycles: the fix loop history (AS-4). Created by Apply Fix (state RUNNING, iteration n+1, requested_by_user_id)
-- or reported by the runtime (requested_by_agent); the runtime moves counts / state through PUT …/cycles/{cycle}.
-- Declared before review_findings because review_findings.fix_cycle_id references it.
CREATE TABLE review_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  pull_request_id uuid NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
  cycle_number integer NOT NULL CHECK (cycle_number >= 1),
  findings_count integer NOT NULL CHECK (findings_count >= 0),
  fixed_count integer NOT NULL DEFAULT 0 CHECK (fixed_count >= 0),
  remaining_count integer NOT NULL CHECK (remaining_count >= 0),
  iteration integer NOT NULL CHECK (iteration >= 1),
  max_iterations integer NOT NULL DEFAULT 5 CHECK (max_iterations >= 1),
  state review_cycle_state NOT NULL DEFAULT 'RUNNING',
  requested_by_user_id uuid REFERENCES users(id),
  requested_by_agent text CHECK (requested_by_agent IS NULL OR char_length(requested_by_agent) <= 80),
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  agent_run_id uuid REFERENCES agent_runs(id) ON DELETE SET NULL,
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pull_request_id, cycle_number),
  CONSTRAINT review_cycles_counts_check CHECK (fixed_count + remaining_count <= findings_count),
  CONSTRAINT review_cycles_iteration_budget_check CHECK (iteration <= max_iterations)
);
CREATE INDEX review_cycles_pr_idx ON review_cycles (pull_request_id, cycle_number DESC);
CREATE TRIGGER review_cycles_updated_at BEFORE UPDATE ON review_cycles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- reviews: one AI review per (pull request, cycle). lanes is exactly 7 × { lane, status, summary? } (the contract
-- validates the lane set; the CHECK guards the cardinality). observed_at is the replace-whole watermark of
-- PUT …/reviews/{cycle}: a body whose observedAt is not newer is `stale`.
CREATE TABLE reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  pull_request_id uuid NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
  external_id text NOT NULL CHECK (external_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  cycle_number integer NOT NULL CHECK (cycle_number >= 1),
  status review_status NOT NULL DEFAULT 'RUNNING',
  lanes jsonb NOT NULL CONSTRAINT reviews_lanes_check CHECK (jsonb_typeof(lanes) = 'array' AND jsonb_array_length(lanes) = 7),
  observed_at timestamptz NOT NULL,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  agent_run_id uuid REFERENCES agent_runs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pull_request_id, cycle_number),
  UNIQUE (organization_id, external_id)
);
CREATE INDEX reviews_pr_idx ON reviews (pull_request_id, cycle_number DESC);
CREATE TRIGGER reviews_updated_at BEFORE UPDATE ON reviews FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- review_findings: one row per reported finding (FR-020). pull_request_id is denormalised so readyForMerge and the
-- list counts never join through reviews. description / impact / recommended_fix are bounded summaries, never
-- chain-of-thought (FR-018). evidence is ≤ 10 US5 EvidenceRef { kind, label, href?, locator?, accessible }.
-- Human actions (FR-021) move state OPEN → DISMISSED (reason ≤ 240, actor, time) | FIX_REQUESTED (fix_cycle_id) |
-- ISSUE_REQUESTED (actor, time); the runtime flips findings to FIXED through the review ingest.
CREATE TABLE review_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  pull_request_id uuid NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
  review_id uuid NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  external_id text NOT NULL CHECK (external_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  position smallint NOT NULL CHECK (position BETWEEN 1 AND 50),
  lane review_lane NOT NULL,
  severity finding_severity NOT NULL,
  blocking finding_blocking NOT NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  description text NOT NULL CHECK (char_length(description) <= 2000),
  impact text NOT NULL CHECK (char_length(impact) <= 1000),
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence) = 'array' AND jsonb_array_length(evidence) <= 10),
  recommended_fix text NOT NULL CHECK (char_length(recommended_fix) <= 1000),
  state finding_state NOT NULL DEFAULT 'OPEN',
  dismissed_reason text CHECK (dismissed_reason IS NULL OR char_length(dismissed_reason) <= 240),
  dismissed_by_user_id uuid REFERENCES users(id),
  dismissed_at timestamptz,
  fix_cycle_id uuid REFERENCES review_cycles(id) ON DELETE SET NULL,
  issue_requested_by_user_id uuid REFERENCES users(id),
  issue_requested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (review_id, position),
  UNIQUE (organization_id, external_id),
  CONSTRAINT review_findings_dismissed_check CHECK (state <> 'DISMISSED' OR (dismissed_reason IS NOT NULL AND dismissed_at IS NOT NULL))
);
CREATE INDEX review_findings_review_idx ON review_findings (review_id, position);
CREATE INDEX review_findings_pr_idx ON review_findings (pull_request_id, position);
-- readyForMerge / blockingOpenCount (FR-022): the only rows that make a pull request "not ready".
CREATE INDEX review_findings_blocking_open_idx ON review_findings (pull_request_id)
  WHERE blocking = 'BLOCKING' AND state IN ('OPEN', 'FIX_REQUESTED');
CREATE TRIGGER review_findings_updated_at BEFORE UPDATE ON review_findings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Live updates (FR-034): statement-level triggers over transition tables, de-duplicated per transaction per workflow
-- (same shape as notify_agent_decision_changed in 0006). A review replacement (review UPDATE + DELETE + batch INSERT
-- of findings + cycle upsert) is one inbox_change_log row and one NOTIFY per workflow; so is a single human action.
-- The payload shape is the one notify_inbox_changed() emits, so the SSE fan-out and client filters are unchanged.
CREATE FUNCTION notify_review_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record; v_seq bigint; v_key text;
BEGIN
  FOR r IN EXECUTE format(
    'SELECT DISTINCT d.organization_id, d.project_id, d.workflow_id FROM %I d
     WHERE EXISTS (SELECT 1 FROM workflows w WHERE w.id = d.workflow_id)',
    CASE TG_OP WHEN 'DELETE' THEN 'deleted' ELSE 'inserted' END)
  LOOP
    v_key := 'cdevi.reviews_notified_' || replace(r.workflow_id::text, '-', '');
    CONTINUE WHEN coalesce(current_setting(v_key, true), '') = '1';
    PERFORM set_config(v_key, '1', true);
    INSERT INTO inbox_change_log (organization_id, project_id, workflow_id)
      VALUES (r.organization_id, r.project_id, r.workflow_id) RETURNING seq INTO v_seq;
    PERFORM pg_notify('inbox_changed', json_build_object('seq', v_seq, 'organizationId', r.organization_id,
      'projectId', r.project_id, 'workflowId', r.workflow_id)::text);
  END LOOP;
  RETURN NULL;
END $$;

CREATE TRIGGER inbox_changed_pull_requests AFTER INSERT ON pull_requests
  REFERENCING NEW TABLE AS inserted FOR EACH STATEMENT EXECUTE FUNCTION notify_review_changed();
CREATE TRIGGER inbox_changed_pull_requests_updated AFTER UPDATE ON pull_requests
  REFERENCING NEW TABLE AS inserted FOR EACH STATEMENT EXECUTE FUNCTION notify_review_changed();
CREATE TRIGGER inbox_changed_reviews AFTER INSERT ON reviews
  REFERENCING NEW TABLE AS inserted FOR EACH STATEMENT EXECUTE FUNCTION notify_review_changed();
CREATE TRIGGER inbox_changed_reviews_updated AFTER UPDATE ON reviews
  REFERENCING NEW TABLE AS inserted FOR EACH STATEMENT EXECUTE FUNCTION notify_review_changed();
CREATE TRIGGER inbox_changed_review_findings AFTER INSERT ON review_findings
  REFERENCING NEW TABLE AS inserted FOR EACH STATEMENT EXECUTE FUNCTION notify_review_changed();
CREATE TRIGGER inbox_changed_review_findings_updated AFTER UPDATE ON review_findings
  REFERENCING NEW TABLE AS inserted FOR EACH STATEMENT EXECUTE FUNCTION notify_review_changed();
CREATE TRIGGER inbox_changed_review_findings_deleted AFTER DELETE ON review_findings
  REFERENCING OLD TABLE AS deleted FOR EACH STATEMENT EXECUTE FUNCTION notify_review_changed();
CREATE TRIGGER inbox_changed_review_cycles AFTER INSERT ON review_cycles
  REFERENCING NEW TABLE AS inserted FOR EACH STATEMENT EXECUTE FUNCTION notify_review_changed();
CREATE TRIGGER inbox_changed_review_cycles_updated AFTER UPDATE ON review_cycles
  REFERENCING NEW TABLE AS inserted FOR EACH STATEMENT EXECUTE FUNCTION notify_review_changed();

-- audit_events (0003) constrains action only by length (≤ 80), so finding.dismissed / finding.fix_requested /
-- finding.issue_requested with target_type 'review_finding' are already legal; the append-only trigger stays.

-- RLS policies (same shape as 0001–0006; ENABLE/DISABLE is owned by migrate.ts) and grants. Ingestion upserts
-- pull requests, reviews and cycles in place (SELECT, INSERT, UPDATE); a review replacement is DELETE + batch INSERT
-- of findings and human actions UPDATE a finding in place, so review_findings also gets DELETE.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pull_requests','reviews','review_findings','review_cycles'] LOOP
    EXECUTE format('CREATE POLICY %I_org_isolation ON %I USING (organization_id = current_setting(''app.organization_id'', true)::uuid)', t, t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON pull_requests, reviews, review_cycles TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON review_findings TO app_user;
