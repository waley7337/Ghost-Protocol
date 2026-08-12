-- 006_google_oauth.sql
-- Google OAuth identity linkage + one-time exchange codes for browser/desktop callbacks.
-- google_sub is Google's stable subject. Email remains unique (no duplicate accounts).

ALTER TABLE users
  ADD COLUMN google_sub TEXT;

CREATE UNIQUE INDEX users_google_sub_unique
  ON users (google_sub)
  WHERE google_sub IS NOT NULL;

CREATE TABLE oauth_exchanges (
  code_hash TEXT PRIMARY KEY,
  bundle_json TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);

CREATE INDEX oauth_exchanges_expires_at
  ON oauth_exchanges (expires_at);
