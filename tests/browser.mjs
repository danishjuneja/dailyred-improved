// Quick browser check for a built site, including the container image.
// Usage: node tests/browser.mjs http://127.0.0.1:8080
import { launchBrowser } from './lib.mjs';

const url = process.argv[2];
if (!url) throw new Error('Pass the URL of a running Daily Red site.');

const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url);
  if (await page.locator('#wordle-question').isVisible()) {
    await page.locator('#wordle-yes').click();
    await page.waitForFunction(() => document.querySelector('.app')?.dataset.state === 'reveal', null, { timeout: 30000 });
    await page.locator('#reveal-play').click();
  } else {
    await page.locator('#play').click();
  }
  await page.waitForFunction(() => document.querySelector('.app')?.dataset.state === 'playing', null, { timeout: 60000 });
  const running = await page.evaluate(() => Boolean(window.dailyRed.emulator && document.querySelector('canvas')));
  if (!running || errors.length) throw new Error(`Game did not start cleanly: ${errors.join('; ')}`);
  console.log('Game loaded and emulator started in the browser.');
} finally {
  await browser.close();
}
