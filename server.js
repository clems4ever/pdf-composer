// PDF Composer server.
//
// The server is deliberately stateless: it only serves the static app and its
// libraries. PDFs and images are opened, composed and exported entirely in the
// browser, so user files never reach this process. To keep it that way the
// server accepts GET/HEAD only, never parses request bodies and never writes
// to disk.
const express = require('express');
const path = require('path');

const app = express();
app.disable('x-powered-by');

app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.set('Allow', 'GET, HEAD');
    return res.status(405).end();
  }
  res.set({
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "worker-src 'self' blob:",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' blob: data:",
      "font-src 'self' data: blob:",
      "connect-src 'self' blob: data:",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join('; '),
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  next();
});

const assets = (dir) => express.static(path.join(__dirname, dir), { index: false, redirect: false });
app.use('/lib/pdfjs', assets('node_modules/pdfjs-dist/build'));
app.use('/lib/pdf-lib', assets('node_modules/pdf-lib/dist'));
app.use('/lib/inter', assets('node_modules/@fontsource-variable/inter'));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/healthz', (req, res) => res.type('text').send('ok'));
app.use((req, res) => res.status(404).type('text').send('Not found'));

const port = process.env.PORT ? Number(process.env.PORT) : 8000; // PORT=0 picks a free port (tests)
const server = app.listen(port, '0.0.0.0', () => console.log(`PDF Composer listening on :${port}`));

// let `docker stop` shut down promptly
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => server.close(() => process.exit(0)));

module.exports = server;
