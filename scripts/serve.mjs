// Dependency-free static server for local play and container hosting.
//   node scripts/serve.mjs [port]      -> http://127.0.0.1:8080
//   HOST=0.0.0.0 node scripts/serve.mjs -> listen on all interfaces
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { securityHeaders } from './http-headers.mjs';
import { createWordleHandler } from './wordle-api.mjs';

const root = resolve(fileURLToPath(new URL('../web', import.meta.url)));
const port = Number(process.argv[2] ?? process.env.PORT ?? 8080);
const host = process.env.HOST || '127.0.0.1';

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.gba': 'application/octet-stream',
  '.gz': 'application/gzip',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function inside(base, target) {
  const path = relative(base, target);
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

export function createWebServer({ fetchWordle = fetch } = {}) {
  const handleWordle = createWordleHandler({ fetchWordle });

  return createServer(async (req, res) => {
    const headers = { ...securityHeaders, 'Cache-Control': 'no-cache' };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { ...headers, Allow: 'GET, HEAD' }).end();
      return;
    }
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/wordle/')) {
        await handleWordle(req, res);
        return;
      }
      const requested = resolve(root, decodeURIComponent(url.pathname).replace(/^\/+/, ''));
      if (!inside(root, requested)) {
        res.writeHead(403, headers).end();
        return;
      }
      const candidate = (await stat(requested)).isDirectory() ? join(requested, 'index.html') : requested;
      const actual = await realpath(candidate);
      if (!inside(await realpath(root), actual)) {
        res.writeHead(403, headers).end();
        return;
      }
      const info = await stat(actual);
      if (!info.isFile()) throw new Error('Not a file');
      res.writeHead(200, {
        ...headers,
        'Content-Type': types[extname(actual)] || 'application/octet-stream',
        'Content-Length': info.size,
      });
      if (req.method === 'HEAD') res.end();
      else createReadStream(actual).on('error', () => res.destroy()).pipe(res);
    } catch {
      if (!res.headersSent) res.writeHead(404, headers).end('Not found');
      else res.destroy();
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');
  const server = createWebServer();
  server.listen(port, host, () => {
    console.log(`Serving ${root} at http://localhost:${server.address().port}`);
  });
}
