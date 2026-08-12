-- 001_create_users.sql
-- Core identity table. Password hashing is implemented in Phase 3 (Argon2id).
-- Email is stored normalized (lowercase); uniqueness is enforced on email.

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  password_hash TEXT,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_email_not_blank CHECK (length(trim(email)) > 0),
  CONSTRAINT users_email_normalized CHECK (email = lower(email))
);

CREATE UNIQUE INDEX users_email_unique ON users (email);
