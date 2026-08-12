# First-party PostgreSQL migrations

Deterministic SQL migrations applied by `src/db/migrate.js`.

| File | Purpose |
|------|---------|
| `001_create_users.sql` | Identity table |
| `002_create_sessions.sql` | Session credential hashes for Phase 3 |
| `003_create_profiles.sql` | One profile per user |
| `004_create_user_progress.sql` | One JSONB progress document per user |

Tracking table `schema_migrations` is created by the runner.

`ON DELETE CASCADE` is used from `users` to child tables so account deletion removes owned sessions, profile, and progress (no orphaned user data).
