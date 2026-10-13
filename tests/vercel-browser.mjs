// Test the exact static output, without requiring Vercel credentials.
// Actual Vercel CDN headers/routing still need a deployed preview check.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { OUTPUT } from '../scripts/build-vercel.mjs';
import { createWebServer } from '../scripts/serve.mjs';
import { launchBrowser } from './lib.mjs';

const requests = new Map();
const server = createWebServer({
  webRoot: join(OUTPUT, 'static'),
  fetchWordle: async (url) => Response.json({ print_date: url.split('/').at(-1).slice(0, 10), solution: 'yodel' }),
});
server.on('request', (req) => requests.set(req.url, (requests.get(req.url) || 0) + 1));
await new Promise((done) => server.listen(0, '127.0.0.1', done));
let browser;
try {
  browser = await launchBrowser();
  const context = await browser.newContext();
  const errors = [];
  let team;
  for (let visit = 0; visit < 2; visit++) {
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    if (!visit) assert.ok(![...requests.keys()].some((url) => /\.(wasm|gz)$/.test(url)), 'large downloads wait for Play');
    await page.locator('#wordle-yes').click();
    await page.waitForFunction(() => document.querySelector('.app').dataset.state === 'reveal');
    const revealed = await page.locator('#reveal-team').innerText();
    if (visit) assert.equal(revealed, team, 'same daily team on return');
    else team = revealed;
    await page.locator('#reveal-play').click();
    await page.waitForFunction(() => document.querySelector('.app').dataset.state === 'playing', null, { timeout: 60000 });
    assert.ok(await page.evaluate(() => window.dailyRed.emulator && Boolean(document.querySelector('canvas'))));
    await page.close();
  }
  const binaries = [...requests.entries()].filter(([url]) => /\.(wasm|gz)$/.test(url));
  assert.equal(binaries.length, 2);
  for (const [url, count] of binaries) {
    assert.ok(url.startsWith('/_vercel/immutable/'));
    assert.equal(count, 1, `${url} downloads once across two visits`);
  }
  assert.deepEqual(errors, []);
  console.log('PASS: compiled static site boots twice, preserves the daily team, and reuses the ROM/WASM from browser cache.');
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
