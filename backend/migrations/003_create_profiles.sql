-- 003_create_profiles.sql
-- One profile per user. Authentication fields (email/password) live on users.
-- ON DELETE CASCADE: profile is user-owned and removed with the account.

CREATE TABLE profiles (
  user_id UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT profiles_name_not_blank CHECK (length(trim(name)) > 0)
);
