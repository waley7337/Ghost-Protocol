'use strict';

/**
 * Database access placeholder.
 * Phase 1 does not connect to PostgreSQL and does not install an ORM.
 */

function assertDatabaseNotConnected() {
  throw new Error('Database access is not implemented in Phase 1');
}

module.exports = { assertDatabaseNotConnected };
