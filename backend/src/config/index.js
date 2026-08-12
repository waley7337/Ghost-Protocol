'use strict';

/**
 * Environment loading for the API scaffold.
 * Phase 1: read process.env only. No secret validation beyond basics.
 * Auth/DB wiring arrives in later phases.
 */

function loadConfig() {
  const port = Number.parseInt(process.env.PORT || '3000', 10);

  return Object.freeze({
    nodeEnv: process.env.NODE_ENV || 'development',
    port: Number.isFinite(port) ? port : 3000,
    // Placeholders recognized by .env.example — unused until later phases:
    databaseUrl: process.env.DATABASE_URL || null,
    frontendUrl: process.env.FRONTEND_URL || null,
    apiPublicUrl: process.env.API_PUBLIC_URL || null
  });
}

module.exports = { loadConfig };
