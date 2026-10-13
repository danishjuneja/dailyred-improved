import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createWebServer } from '../scripts/serve.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

test('static server confines requests to web and serves only GET/HEAD', async () => {
  const outside = await mkdtemp(join(root, 'web-outside-'));
  const secret = join(outside, 'secret.txt');
  await writeFile(secret, 'outside-web');
  let linked = false;
  try {
    await symlink(outside, join(root, 'web', 'outside-link'), 'dir');
    linked = true;
  } catch { /* Symlink creation can require elevation on Windows. */ }

  const server = createWebServer();
  try {
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    const url = `http://127.0.0.1:${server.address().port}`;
    const normal = await fetch(url);
    assert.equal(normal.status, 200);
    assert.match(await normal.text(), /Daily Red/);
    assert.equal(normal.headers.get('x-content-type-options'), 'nosniff');
    assert.match(normal.headers.get('content-security-policy'), /object-src 'none'/);
    const cached = await fetch(url, { headers: { 'If-None-Match': normal.headers.get('etag') } });
    assert.equal(cached.status, 304);
    assert.equal(await cached.text(), '');
    assert.equal((await fetch(url, { headers: { 'If-None-Match': '"old-version"' } })).status, 200);

    const head = await fetch(`${url}/app.js`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    assert.equal((await fetch(url, { method: 'POST' })).status, 405);

    const sibling = outside.split(/[\\/]/).at(-1);
    const escape = await fetch(`${url}/..%2f${sibling}%2fsecret.txt`);
    assert.equal(escape.status, 403);
    assert.notEqual(await escape.text(), 'outside-web');
    if (linked) {
      const throughLink = await fetch(`${url}/outside-link/secret.txt`);
      assert.equal(throughLink.status, 403);
      assert.notEqual(await throughLink.text(), 'outside-web');
    }
  } finally {
    await new Promise((done) => server.close(done));
    if (linked) await rm(join(root, 'web', 'outside-link'));
    await rm(outside, { recursive: true, force: true });
  }
});

test('Wordle endpoint validates dates, checks the answer, and caches a successful day', async () => {
  const date = new Date().toISOString().slice(0, 10);
  let calls = 0;
  const server = createWebServer({
    fetchWordle: async (url) => {
      calls++;
      assert.equal(url, `https://www.nytimes.com/svc/wordle/v2/${date}.json`);
      return new Response(JSON.stringify({ print_date: date, solution: 'yodel' }), { status: 200 });
    },
  });
  try {
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    const url = `http://127.0.0.1:${server.address().port}/api/wordle/`;
    assert.equal((await fetch(`${url}2026-99-99`)).status, 400);
    assert.equal((await fetch(`${url}${date}`, { method: 'POST' })).status, 405);
    const response = await fetch(`${url}${date}`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { date, word: 'yodel' });
    assert.deepEqual(await (await fetch(`${url}${date}`)).json(), { date, word: 'yodel' });
    assert.equal(calls, 1);
  } finally {
    await new Promise((done) => server.close(done));
  }
});

test('Wordle endpoint fails closed for an invalid upstream answer', async () => {
  const date = new Date().toISOString().slice(0, 10);
  const server = createWebServer({
    fetchWordle: async () => new Response(JSON.stringify({ print_date: date, solution: 'not-a-word' })),
  });
  try {
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/wordle/${date}`);
    assert.equal(response.status, 502);
    assert.match(await response.text(), /unavailable/);
  } finally {
    await new Promise((done) => server.close(done));
  }
});
