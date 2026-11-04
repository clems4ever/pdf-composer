// Checks that the server stays a stateless static file server.
const { test, after } = require('node:test');
const assert = require('node:assert');

process.env.PORT = '0';
const server = require('../server.js');
const base = () => `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

test('serves the app and its libraries', async () => {
  await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
  for (const p of ['/', '/app.js', '/style.css', '/lib/pdfjs/pdf.min.mjs', '/lib/pdfjs/pdf.worker.min.mjs', '/lib/pdf-lib/pdf-lib.min.js', '/lib/inter/wght.css', '/healthz']) {
    const res = await fetch(base() + p);
    assert.strictEqual(res.status, 200, p);
  }
});

test('rejects every method that could send data to the server', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const res = await fetch(base() + '/', { method, body: 'x'.repeat(1024) });
    assert.strictEqual(res.status, 405, method);
    assert.strictEqual(res.headers.get('allow'), 'GET, HEAD');
  }
});

test('sends a CSP that forbids sending data anywhere else', async () => {
  const csp = (await fetch(base() + '/')).headers.get('content-security-policy');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /connect-src 'self' blob: data:/);
  assert.match(csp, /form-action 'none'/);
});

test('does not expose server files', async () => {
  for (const p of ['/server.js', '/package.json', '/../server.js', '/lib/pdfjs/../../../server.js']) {
    assert.strictEqual((await fetch(base() + p)).status, 404, p);
  }
});
