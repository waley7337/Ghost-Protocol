'use strict';

/**
 * Ghost Protocol backend entrypoint (Phase 1 scaffold).
 *
 * Intentionally minimal:
 * - No authentication
 * - No PostgreSQL connection
 * - No external framework dependency
 *
 * Optional health endpoint exists only to prove the process boots.
 */

const http = require('node:http');
const { loadConfig } = require('./config');
const { createRequestListener } = require('./routes');

const config = loadConfig();
const server = http.createServer(createRequestListener(config));

server.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Ghost Protocol API scaffold listening on port ${config.port}`);
});
