-- 004_create_user_progress.sql
-- One progress document per user. JSONB matches existing GhostProgress shape:
-- { xp, solved, streak, lastDay, bestTimes, notes, quizScores, achievements, unlocks, preferences, settings }
-- ON DELETE CASCADE: progress is user-owned and removed with the account.

CREATE TABLE user_progress (
  user_id UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  progress JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_progress_is_object CHECK (jsonb_typeof(progress) = 'object')
);
