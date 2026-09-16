-- specs/001 US6 follow-up (FR-021, FR-036): a review snapshot (PUT /api/ingest/pull-requests/{externalId}/reviews/{cycle})
-- reconciles findings by external_id — matched rows are UPDATEd in place so their id (audit_events.target_id, the
-- action routes) survives, absent rows are deleted, new rows inserted. Reordering positions in place needs the
-- UNIQUE (review_id, position) check at commit, not per statement: recreate it DEFERRABLE INITIALLY IMMEDIATE under
-- the same name (schema.ts and the 0007 tests refer to it). The ingest sets it DEFERRED for its transaction only;
-- every other writer keeps the immediate check. No RLS or grant change.
ALTER TABLE review_findings
  DROP CONSTRAINT review_findings_review_id_position_key,
  ADD CONSTRAINT review_findings_review_id_position_key UNIQUE (review_id, position) DEFERRABLE INITIALLY IMMEDIATE;
