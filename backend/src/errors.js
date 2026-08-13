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

function redactSecrets(value) {
  if (value == null) return '';
  return String(value)
    .replace(/postgres(?:ql)?:\/\/[^\s"'`]+/gi, '[redacted-db-url]')
    .replace(/\bBearer\s+[^\s"'`]+/gi, 'Bearer [redacted]')
    .replace(/\b(access|refresh|id)_?token["'\s:=]+[^\s"'`,}]+/gi, '$1_token=[redacted]')
    .replace(/\b(password|secret|authorization)["'\s:=]+[^\s"'`,}]+/gi, '$1=[redacted]');
}

/**
 * Log unexpected failures server-side for Railway/operator diagnosis.
 * Does not log passwords, tokens, or connection strings. Clients still get
 * generic internal_error via toClientError.
 */
function logUnexpectedError(error, { route, method } = {}) {
  if (error instanceof AppError && error.expose) return;

  const payload = {
    level: 'error',
    msg: 'unexpected_error',
    route: typeof route === 'string' ? route : undefined,
    method: typeof method === 'string' ? method : undefined,
    name: error?.name || 'Error',
    code: typeof error?.code === 'string' ? error.code : undefined,
    message: redactSecrets(error?.message || 'unknown error')
  };

  if (typeof error?.stack === 'string' && error.stack) {
    payload.stack = redactSecrets(error.stack.split('\n').slice(0, 10).join('\n'));
  }

  process.stderr.write(`${JSON.stringify(payload)}\n`);
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

module.exports = { AppError, toClientError, logUnexpectedError, redactSecrets };
