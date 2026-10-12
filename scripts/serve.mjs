// Dependency-free static server for local play and container hosting.
//   node scripts/serve.mjs [port]      -> http://127.0.0.1:8080
//   HOST=0.0.0.0 node scripts/serve.mjs -> listen on all interfaces
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const securityHeaders = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self' blob: 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
};

function inside(base, target) {
  const path = relative(base, target);
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

export function createWebServer({ fetchWordle = fetch } = {}) {
  const words = new Map();
  async function wordForDate(date) {
    if (!words.has(date)) {
      const pending = (async () => {
        const response = await fetchWordle(`https://www.nytimes.com/svc/wordle/v2/${date}.json`, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) throw new Error(`Wordle returned HTTP ${response.status}`);
        const data = await response.json();
        if (data.print_date !== date || !/^[a-z]{5}$/.test(data.solution)) {
          throw new Error('Wordle returned an invalid answer');
        }
        return data.solution;
      })();
      words.set(date, pending);
      pending.catch(() => words.delete(date));
    }
    return words.get(date);
  }

  return createServer(async (req, res) => {
    const headers = { ...securityHeaders, 'Cache-Control': 'no-cache' };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { ...headers, Allow: 'GET, HEAD' }).end();
      return;
    }
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/wordle/')) {
        const date = url.pathname.slice('/api/wordle/'.length);
        const parsed = new Date(`${date}T00:00:00Z`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)
          || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date
          || Math.abs(parsed.getTime() - Date.now()) > 2 * 86400000) {
          res.writeHead(400, headers).end('Invalid date');
          return;
        }
        try {
          const body = JSON.stringify({ date, word: await wordForDate(date) });
          res.writeHead(200, {
            ...headers,
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': Buffer.byteLength(body),
          }).end(req.method === 'HEAD' ? undefined : body);
        } catch {
          res.writeHead(502, headers).end(req.method === 'HEAD' ? undefined : "Today's Wordle is unavailable. Try again later.");
        }
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
