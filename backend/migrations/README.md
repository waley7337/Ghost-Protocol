# First-party PostgreSQL migrations

Deterministic SQL migrations applied by `src/db/migrate.js`.

| File | Purpose |
|------|---------|
| `001_create_users.sql` | Identity table |
| `002_create_sessions.sql` | Session credential hashes |
| `003_create_profiles.sql` | One profile per user |
| `004_create_user_progress.sql` | One JSONB progress document per user |
| `005_session_refresh_families.sql` | Refresh-token family / replacement linkage |
| `006_google_oauth.sql` | Google `google_sub` + one-time OAuth exchange codes |

Tracking table `schema_migrations` is created by the runner.

`ON DELETE CASCADE` is used from `users` to child tables so account deletion removes owned sessions, profile, and progress (no orphaned user data).
