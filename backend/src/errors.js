'use strict';

/**
 * Application errors safe to map to HTTP responses.
 * Never attach secrets, SQL, or stack traces for client output.
 */

class AppError extends Error {
  constructor(message, { status = 400, code = 'bad_request', expose = true } = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.expose = expose;
  }
}

function toClientError(error) {
  if (error instanceof AppError && error.expose) {
    return {
      status: error.status,
      body: { error: error.code, message: error.message }
    };
  }

  return {
    status: 500,
    body: { error: 'internal_error', message: 'An unexpected error occurred' }
  };
}

module.exports = { AppError, toClientError };
