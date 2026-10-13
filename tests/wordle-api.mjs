import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { createWordleHandler } from '../scripts/wordle-api.mjs';

test('Wordle function caches only valid answers, coalesces requests, expires, and retries errors', async () => {
  let now = Date.parse('2026-10-13T12:00:00Z');
  let calls = 0;
  let answer = 'yodel';
  const server = createServer(createWordleHandler({
    now: () => now,
    fetchWordle: async (url) => {
      calls++;
      assert.equal(url, 'https://www.nytimes.com/svc/wordle/v2/2026-10-13.json');
      return Response.json({ print_date: '2026-10-13', solution: answer });
    },
  }));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}/api/wordle/`;
  try {
    const responses = await Promise.all(Array.from({ length: 5 }, () => fetch(`${base}2026-10-13`)));
    for (const response of responses) {
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'public, max-age=300');
      assert.equal(response.headers.get('cdn-cache-control'), 'public, s-maxage=3600');
      assert.deepEqual(await response.json(), { date: '2026-10-13', word: 'yodel' });
    }
    assert.equal(calls, 1);
    const head = await fetch(`${base}2026-10-13`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    for (const date of ['2026-02-30', '2026-10-01', '2026-10-20', '2026-10-13/extra']) {
      const response = await fetch(base + date);
      assert.equal(response.status, 400);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    const post = await fetch(`${base}2026-10-13`, { method: 'POST' });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get('cache-control'), 'no-store');
    assert.equal(calls, 1);

    now += 3600000;
    answer = 'invalid';
    const failed = await fetch(`${base}2026-10-13`);
    assert.equal(failed.status, 502);
    assert.equal(failed.headers.get('cache-control'), 'no-store');
    assert.equal(failed.headers.get('cdn-cache-control'), null);
    answer = 'yodel';
    assert.equal((await fetch(`${base}2026-10-13`)).status, 200);
    assert.equal(calls, 3);
  } finally {
    await new Promise((done) => server.close(done));
  }
});
