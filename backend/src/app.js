'use strict';

/**
 * Ghost Protocol backend entrypoint (Phase 3).
 *
 * Railway-ready HTTP API with authentication foundation.
 * Electron/web clients are not wired to these endpoints yet.
 */

const http = require('node:http');
const { loadConfig, assertProductionConfig, ConfigError } = require('./config');
const { createRequestListener } = require('./routes');
const { closePool } = require('./db');

let config;
try {
  config = loadConfig();
  assertProductionConfig(config);
} catch (error) {
  const message = error instanceof ConfigError ? error.message : 'Invalid server configuration';
  // Never include env values — message must stay secret-free.
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const server = http.createServer(createRequestListener(config));

let shuttingDown = false;

function listen() {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stderr.write(`Shutting down (${signal})\n`);

  await new Promise((resolve) => {
    server.close(() => resolve());
    // Force-continue if close hangs (idle keep-alives).
    setTimeout(resolve, 10_000).unref();
  });

  try {
    await closePool();
  } catch {
    process.stderr.write('Failed to close database pool cleanly\n');
  }
}

async function main() {
  await listen();
  // Do not log DATABASE_URL, hosts from secrets, or credential material.
  process.stdout.write(
    `Ghost Protocol API listening on ${config.host}:${config.port} (${config.nodeEnv})\n`
  );
}

process.on('SIGINT', () => {
  shutdown('SIGINT').finally(() => process.exit(0));
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM').finally(() => process.exit(0));
});

main().catch((error) => {
  const message = error instanceof ConfigError ? error.message : 'Failed to start server';
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
