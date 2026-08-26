/* Local dev server: serves public/ and runs the api/ handlers in process.
 * Run with MOCK=1 to serve fixture data instead of calling CNBC. */

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (process.env.MOCK === '1') {
  const { installMockFetch } = await import('./mock-cnbc.mjs');
  installMockFetch();
  console.log('[dev] serving mock CNBC data');
}

const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
const handlers = {
  '/api/quotes': require(path.join(root, 'api/quotes.js')),
  '/api/news': require(path.join(root, 'api/news.js')),
};

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');

  if (handlers[pathname]) {
    try {
      await handlers[pathname](req, res);
    } catch (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, error: error.message }));
    }
    return;
  }

  const file = pathname === '/' ? '/index.html' : pathname;
  const target = path.join(root, 'public', path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
  try {
    const body = await fs.readFile(target);
    res.setHeader('Content-Type', TYPES[path.extname(target)] || 'application/octet-stream');
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end('Not found');
  }
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, () => console.log(`[dev] http://localhost:${port}`));
