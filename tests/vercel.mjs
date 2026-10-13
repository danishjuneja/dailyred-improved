import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { test } from 'node:test';
import { OUTPUT, ASSETS } from '../scripts/build-vercel.mjs';
import { securityHeaders } from '../scripts/http-headers.mjs';

test('prebuilt deployment serves content-addressed game files statically with only a small Wordle function', async () => {
  const config = JSON.parse(await readFile(join(OUTPUT, 'config.json')));
  const manifest = JSON.parse(await readFile(join(OUTPUT, 'immutable.json')));
  assert.equal(config.version, 3);
  assert.equal(manifest.version, 1);
  assert.equal(Object.keys(manifest.hashes).length, ASSETS.length);
  assert.deepEqual(config.routes[0].headers, securityHeaders);
  const assets = {};
  for (const path of ASSETS) {
    const url = Object.keys(manifest.hashes).find((url) => url.endsWith(`/${basename(path)}${path.endsWith('.wasm') ? '.gz' : ''}`));
    assert.ok(url, `${path} content hash exists`);
    const bytes = await readFile(join(OUTPUT, 'static', url));
    const hash = createHash('sha256').update(bytes).digest('hex');
    assert.equal(manifest.hashes[url], hash);
    if (path.endsWith('.wasm')) {
      const wasm = gunzipSync(bytes);
      assert.equal(wasm.subarray(0, 4).toString(), '\0asm');
      assert.ok(bytes.length < wasm.length / 2, 'compressed WASM saves at least half the download');
    }
    assets[path] = url;
    const routes = config.routes.filter((route) => route.src && new RegExp(`^${route.src}$`).test(url));
    assert.ok(routes.some((route) => route.headers?.['Cache-Control'] === 'public, max-age=31536000, immutable'));
    assert.ok(routes.every((route) => !route.dest), `${path} must never route to a function`);
  }
  const gameFiles = await readFile(join(OUTPUT, 'static/game-files.js'), 'utf8');
  for (const path of ASSETS.slice(0, 4).filter((path) => !path.endsWith('.png'))) {
    assert.ok(gameFiles.includes(assets[path]));
  }
  const index = await readFile(join(OUTPUT, 'static/index.html'), 'utf8');
  assert.ok(index.includes(assets['game/red.png']));
  assert.ok(index.includes('analytics.js'));
  const app = await readFile(join(OUTPUT, 'static/app.js'), 'utf8');
  assert.ok(app.includes(`from '${assets['vendor/nostalgist.js']}'`));
  assert.ok(config.routes.some((route) => route.src && new RegExp(`^${route.src}$`).test('/index.html')
    && route.headers?.['Cache-Control'] === 'public, max-age=0, must-revalidate'));
  assert.equal(config.overrides[assets['vendor/mgba_libretro.wasm'].slice(1)].contentType, 'application/gzip');
  assert.deepEqual(await readdir(join(OUTPUT, 'functions')), ['api']);
  assert.deepEqual(await readdir(join(OUTPUT, 'functions/api')), ['wordle.func']);
  const func = join(OUTPUT, 'functions/api/wordle.func');
  assert.deepEqual((await readdir(func)).sort(), ['.vc-config.json', 'http-headers.mjs', 'wordle-api.mjs']);
  assert.equal(typeof (await import(pathToFileURL(join(func, 'wordle-api.mjs')))).default, 'function');
  assert.ok(config.routes.some((route) => route.src === '/api/wordle/(.*)' && route.dest === '/api/wordle'));
});
