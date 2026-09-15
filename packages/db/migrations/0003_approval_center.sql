-- specs/001 US2 — Approval Center (data-model.md §11–§12, research R14–R15).
-- Run as `migrator`. Human decisions extend approvals/clarifications with context, links and the recorded
-- answer/rejection; every decision also appends to the append-only audit_events table. RLS follows 0001_init.sql.

-- §11.1 approvals: agent-supplied context and links; human rejection metadata and decider identity.
ALTER TABLE approvals
  ADD COLUMN context text CHECK (context IS NULL OR char_length(context) <= 2000),
  ADD COLUMN links jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN rejection_reason text CONSTRAINT approvals_rejection_reason_length CHECK (rejection_reason IS NULL OR char_length(rejection_reason) <= 500),
  ADD COLUMN rejection_target workflow_state CONSTRAINT approvals_rejection_target_check CHECK (rejection_target IS NULL OR rejection_target IN ('BLOCKED', 'CANCELLED')),
  ADD COLUMN decided_by_user_id uuid REFERENCES users(id),
  -- A human rejection always carries a reason (scenario 5); agent-ingested decisions are unconstrained.
  ADD CONSTRAINT approvals_rejection_reason_check
    CHECK (decided_by_user_id IS NULL OR decision <> 'rejected' OR rejection_reason IS NOT NULL);
CREATE INDEX approvals_decided_by_user_idx ON approvals (decided_by_user_id) WHERE decided_by_user_id IS NOT NULL;

-- §11.2 clarifications: why it matters, suggested options, links; the recorded answer and answerer identity.
ALTER TABLE clarifications
  ADD COLUMN why_it_matters text CHECK (why_it_matters IS NULL OR char_length(why_it_matters) <= 1000),
  ADD COLUMN options jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(options) = 'array'),
  ADD COLUMN links jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN answer_option text CHECK (answer_option IS NULL OR char_length(answer_option) <= 80),
  ADD COLUMN answer_text text CONSTRAINT clarifications_answer_text_length CHECK (answer_text IS NULL OR char_length(answer_text) <= 2000),
  ADD COLUMN answered_by_user_id uuid REFERENCES users(id),
  -- A human answer always carries text (the option label or the free text).
  ADD CONSTRAINT clarifications_answer_check
    CHECK (answered_at IS NULL OR answer_text IS NOT NULL OR answered_by_user_id IS NULL);
CREATE INDEX clarifications_answered_by_user_idx ON clarifications (answered_by_user_id) WHERE answered_by_user_id IS NOT NULL;

-- §12 audit_events: one row per human decision (FR-029); append-only.
CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  project_id uuid REFERENCES projects(id),
  workflow_id uuid REFERENCES workflows(id) ON DELETE SET NULL,
  actor_type text NOT NULL,
  actor_id text,
  actor_name text NOT NULL CHECK (char_length(actor_name) <= 120),
  action text NOT NULL CHECK (char_length(action) <= 80),
  target_type text NOT NULL CHECK (char_length(target_type) <= 40),
  target_id uuid NOT NULL,
  risk_level risk_level,
  policy text,
  result text NOT NULL CHECK (char_length(result) <= 80),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_events_actor_type_check CHECK (actor_type IN ('user', 'agent', 'system'))
);
CREATE INDEX audit_events_org_time_idx ON audit_events (organization_id, occurred_at DESC);
CREATE INDEX audit_events_target_idx ON audit_events (target_type, target_id, occurred_at DESC);
CREATE INDEX audit_events_workflow_idx ON audit_events (workflow_id, occurred_at DESC);

CREATE FUNCTION audit_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only' USING ERRCODE = 'P0001';
END $$;
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();

-- Row-level security policy (enabled by flag — architecture §6).
CREATE POLICY audit_events_org_isolation ON audit_events USING (organization_id = current_setting('app.organization_id', true)::uuid);

-- Grants: the application role may read and append audit events, never change them.
GRANT SELECT, INSERT ON audit_events TO app_user;
