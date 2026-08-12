-- 005_session_refresh_families.sql
-- Phase 3.1: refresh-token family tracking for rotation reuse detection.
-- Does not rewrite prior migrations.

ALTER TABLE sessions
  ADD COLUMN family_id UUID,
  ADD COLUMN parent_session_id UUID REFERENCES sessions (id) ON DELETE SET NULL,
  ADD COLUMN replaced_by_session_id UUID REFERENCES sessions (id) ON DELETE SET NULL;

-- Existing rows (if any) become single-member families rooted at themselves.
UPDATE sessions
SET family_id = id
WHERE family_id IS NULL;

ALTER TABLE sessions
  ALTER COLUMN family_id SET NOT NULL;

CREATE INDEX sessions_family_id_idx ON sessions (family_id);

-- At most one non-revoked refresh session may exist per family.
CREATE UNIQUE INDEX sessions_one_active_per_family
  ON sessions (family_id)
  WHERE (revoked_at IS NULL);
