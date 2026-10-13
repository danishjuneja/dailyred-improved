import { securityHeaders } from './http-headers.mjs';

const HOUR = 3600000;
const DAY = 24 * HOUR;

// The same handler runs in a Vercel Function and the standalone Node server.
export function createWordleHandler({ fetchWordle = fetch, now = Date.now } = {}) {
  const words = new Map();
  async function wordForDate(date) {
    for (const [key, entry] of words) {
      if (entry.expires <= now()) words.delete(key);
    }
    if (!words.has(date)) {
      const entry = { expires: now() + HOUR };
      entry.promise = (async () => {
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
      words.set(date, entry);
      entry.promise.catch(() => {
        if (words.get(date) === entry) words.delete(date);
      });
    }
    return words.get(date).promise;
  }

  return async (req, res) => {
    const headers = { ...securityHeaders, 'Cache-Control': 'no-store' };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { ...headers, Allow: 'GET, HEAD' }).end();
      return;
    }
    const url = new URL(req.url, 'http://localhost');
    const date = url.pathname.replace(/^\/api\/wordle\//, '');
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)
      || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date
      || Math.abs(parsed.getTime() - now()) > 2 * DAY) {
      res.writeHead(400, headers).end(req.method === 'HEAD' ? undefined : 'Invalid date');
      return;
    }
    try {
      const body = JSON.stringify({ date, word: await wordForDate(date) });
      res.writeHead(200, {
        ...headers,
        'Cache-Control': 'public, max-age=300',
        'CDN-Cache-Control': 'public, s-maxage=3600',
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
      }).end(req.method === 'HEAD' ? undefined : body);
    } catch {
      res.writeHead(502, headers).end(req.method === 'HEAD' ? undefined : "Today's Wordle is unavailable. Try again later.");
    }
  };
}

export default createWordleHandler();
