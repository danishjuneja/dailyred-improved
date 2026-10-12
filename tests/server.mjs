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
