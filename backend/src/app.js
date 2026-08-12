'use strict';

/**
 * Ghost Protocol backend entrypoint (Phase 2).
 *
 * Provides PostgreSQL data foundation helpers and health endpoints.
 * Authentication and private resource APIs are not implemented yet.
 */

const http = require('node:http');
const { loadConfig } = require('./config');
const { createRequestListener } = require('./routes');
const { closePool } = require('./db');

const config = loadConfig();
const server = http.createServer(createRequestListener(config));

server.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Ghost Protocol API listening on port ${config.port}`);
});

async function shutdown() {
  server.close();
  await closePool();
}

process.on('SIGINT', () => {
  shutdown().finally(() => process.exit(0));
});

process.on('SIGTERM', () => {
  shutdown().finally(() => process.exit(0));
});
