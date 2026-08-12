'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createRequestListener } = require('../src/routes');

test('GET /health returns ok scaffold payload', async () => {
  const server = http.createServer(
    createRequestListener({ nodeEnv: 'test', port: 0 })
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.service, 'ghost-protocol-api');
    assert.equal(body.phase, 1);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
