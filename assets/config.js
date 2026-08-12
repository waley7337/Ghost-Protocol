/**
 * Public client configuration only.
 * Set GHOST_API_BASE_URL to the Ghost Protocol backend origin (HTTPS in production).
 * Never put DATABASE_URL, ACCESS_TOKEN_SECRET, REFRESH_TOKEN_SECRET, or Postgres
 * credentials in this file or any Vercel/browser env.
 *
 * Local default matches the backend .env.example PORT.
 * Production web builds overwrite this via `npm run build:web`.
 */
window.GHOST_API_BASE_URL = window.GHOST_API_BASE_URL || 'http://127.0.0.1:3000';
