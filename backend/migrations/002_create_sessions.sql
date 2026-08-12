-- 002_create_sessions.sql
-- Session rows for Phase 3 refresh/session security.
-- refresh_token_hash stores a one-way hash only — never plaintext refresh tokens.
-- ON DELETE CASCADE: deleting a user removes their sessions (no orphaned credentials).

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  refresh_token_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  user_agent TEXT,
  ip_address INET,
  CONSTRAINT sessions_refresh_token_hash_not_blank CHECK (length(trim(refresh_token_hash)) > 0),
  CONSTRAINT sessions_expires_after_created CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX sessions_refresh_token_hash_unique ON sessions (refresh_token_hash);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);
