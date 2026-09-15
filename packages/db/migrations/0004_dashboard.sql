-- 0004_dashboard: indexes only for the Dashboard read model (specs/001 data-model.md §18, research R23).
-- No tables, columns, triggers, RLS policies or grants change; rollback is DROP INDEX IF EXISTS for the five names.

-- Windowed health aggregates (test pass rate, agent success rate) per organization/project.
CREATE INDEX test_runs_org_project_finished_idx  ON test_runs  (organization_id, project_id, finished_at) WHERE finished_at IS NOT NULL;
CREATE INDEX agent_runs_org_project_finished_idx ON agent_runs (organization_id, project_id, finished_at) WHERE finished_at IS NOT NULL;

-- Risk area: HIGH/CRITICAL audit events in the window.
CREATE INDEX audit_events_org_risk_time_idx      ON audit_events (organization_id, project_id, occurred_at DESC) WHERE risk_level IN ('HIGH','CRITICAL');

-- Human-intervention rate joins approvals/clarifications by workflow.
CREATE INDEX approvals_workflow_idx              ON approvals (workflow_id);
CREATE INDEX clarifications_workflow_idx         ON clarifications (workflow_id);
