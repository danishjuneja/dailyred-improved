// Website test: drives index.html like a player would and checks the daily
// game across several (faked) days: stats, one battle per day, win / loss /
// abandoned battles, streaks, practice runs, the phone layout and the error
// screen. Screenshots go to tests/output/site-*.png.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  startServer, launchBrowser, sleep, press, getStatus, waitFor, startRedBattle, forceWin, forceLoss,
} from './lib.mjs';
import { readParty, teamBaseStatTotal, isLegendary, hasDamagingMove } from './party.mjs';

const OUT = fileURLToPath(new URL('./output/', import.meta.url));
mkdirSync(OUT, { recursive: true });

let failures = 0;
function check(ok, message) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${message}`);
  if (!ok) failures++;
}

const DAY1 = '2026-10-11', DAY2 = '2026-10-12', DAY3 = '2026-10-13', DAY5 = '2026-10-15';
const WORDS = { [DAY1]: 'yodel', [DAY2]: 'fizzy', [DAY3]: 'flame', [DAY5]: 'zzzzz' };
const mockWordle = (context) => context.route('**/api/wordle/*', (route) => {
  const date = new URL(route.request().url()).pathname.split('/').at(-1);
  const word = WORDS[date];
  return route.fulfill({ status: word ? 200 : 404, json: { date, word } });
});
const at = (date, time = '10:00:00') => new Date(`${date}T${time}`);

const state = (page) => page.evaluate(() => document.querySelector('.app').dataset.state);
const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('dailyred-stats') || 'null'));
const shown = (page) => page.evaluate(() => ({
  wins: document.getElementById('stat-wins').textContent,
  losses: document.getElementById('stat-losses').textContent,
  winStreak: document.getElementById('stat-win-streak').textContent,
  dayStreak: document.getElementById('stat-day-streak').textContent,
  canPlay: !document.getElementById('play').hidden || !document.getElementById('wordle-question').hidden,
  played: document.getElementById('played').hidden ? null : document.getElementById('played-result').textContent,
  next: document.getElementById('played-next').textContent,
}));
const statLine = (s) => `${s.wins}W ${s.losses}L, win streak ${s.winStreak}, day streak ${s.dayStreak}`;

// The test helpers talk to window.emu; point it at the site's emulator.
async function attach(page) {
  await page.waitForFunction(() => document.querySelector('.app').dataset.state === 'playing', null, { timeout: 60000 });
  await page.evaluate(() => { window.emu = window.dailyRed.emulator; });
  return waitFor(page, (s) => s.inOverworld, { what: 'overworld', timeoutMs: 30000 });
}

async function revealAndPlay(page, answer = 'yes') {
  await page.click(`#wordle-${answer}`);
  await page.waitForFunction(() => document.querySelector('.app').dataset.state === 'reveal');
  const preview = await page.locator('#reveal-team li').evaluateAll((items) => items.map((item) => Number(item.dataset.speciesId)));
  await page.click('#reveal-play');
  await attach(page);
  return preview;
}

// Presses A through the end of the battle and the closing messages until the
// site has closed the game and is back on the title card.
async function finishDailyGame(page, shotPrefix) {
  for (let i = 0; i < 120; i++) {
    if ((await state(page)) === 'title') return true;
    if (shotPrefix && i % 3 === 0) await page.locator('canvas').first().screenshot({ path: `${OUT}/${shotPrefix}-${String(i).padStart(3, '0')}.png` }).catch(() => {});
    await press(page, 'a');
    await sleep(400);
  }
  return false;
}

const server = await startServer();
const browser = await launchBrowser();
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await mockWordle(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // Day 1: a fresh visitor.
  await page.clock.setFixedTime(at(DAY1));
  await page.goto(server.url);
  await sleep(1200);
  await page.screenshot({ path: `${OUT}/site-title.png`, fullPage: true });
  let s = await shown(page);
  check(s.canPlay && s.wins === '0' && s.losses === '0' && s.winStreak === '0' && s.dayStreak === '0', `new visitor sees the Wordle question and zeroed stats (${statLine(s)})`);
  check(await page.evaluate(() => document.querySelector('.red-sprite').naturalWidth === 64), "RED's sprite is shown on the title card");
  const leftovers = await page.evaluate(() => ['.tagline', '.steps', '#seed', '#new-run'].filter((sel) => document.querySelector(sel)));
  check(leftovers.length === 0, `removed: tagline, how-it-works, seed, New run (${leftovers.join(', ') || 'none left'})`);
  const footer = await page.evaluate(() => document.querySelector('.footer')?.textContent || '');
  check(/unofficial fan project/.test(footer) && /not affiliated|isn't affiliated/.test(footer), 'footer shows the fan-project disclaimer');
  const licenses = await page.evaluate(async () => {
    const link = document.querySelector('.footer a[href="licenses.txt"]');
    return link ? (await fetch(link.href)).status : 0;
  });
  check(licenses === 200, `footer links to licenses.txt (status ${licenses})`);
  check(!(await page.locator('.pad').isVisible()), 'touch controls are hidden on desktop');

  let romRequests = 0;
  page.on('request', (request) => { if (request.url().endsWith('/game/dailyred.gba.gz')) romRequests++; });
  await page.click('#wordle-no');
  await page.waitForFunction(() => document.querySelector('.app').dataset.state === 'reveal');
  await page.screenshot({ path: `${OUT}/site-reveal.png`, fullPage: true });
  check(romRequests === 0 && await page.locator('#reveal-word').textContent() === WORDS[DAY1],
    'the answer and team are revealed before the ROM loads');
  const preview1 = await page.locator('#reveal-team li').evaluateAll((items) => items.map((item) => Number(item.dataset.speciesId)));
  await page.click('#reveal-play');
  await attach(page);
  const box = await page.locator('canvas').boundingBox();
  check(Math.round(box.width) === 720 && Math.round(box.height) === 480, `game screen is 720x480 on desktop (got ${box.width}x${box.height})`);
  const firstParty = readParty((await getStatus(page)).mem).party;
  const team1 = JSON.stringify(firstParty.map((m) => m.species));
  check(JSON.stringify(preview1) === team1, 'the revealed team matches the ROM party');
  const starSlot = await page.locator('#reveal-team li').evaluateAll((items) =>
    items.findIndex((item) => item.querySelector('.team-role')?.textContent === 'Star'));
  check(starSlot >= 0 && hasDamagingMove(firstParty[starSlot]), 'the revealed star has a damaging move');
  check(firstParty.slice(0, 5).every((m, i) => m.speciesName[0].toLowerCase() === WORDS[DAY1][i])
    && isLegendary(firstParty[5]) && firstParty.slice(0, 5).every((m) => !isLegendary(m))
    && teamBaseStatTotal(firstParty) >= 2700,
  `daily team spells ${WORDS[DAY1].toUpperCase()}, ends in a legendary, and reaches 2700`);

  await startRedBattle(page);
  await sleep(1000);
  check((await saved(page))?.pending === DAY1, 'once the battle starts, today counts as played');
  await forceWin(page);
  check(await finishDailyGame(page, 'site-win'), 'after a win the site closes the game and returns to the title card');
  s = await shown(page);
  check(s.wins === '1' && s.losses === '0' && s.winStreak === '1' && s.dayStreak === '1', `win recorded (${statLine(s)})`);
  check(!s.canPlay && s.played === 'You beat RED today!' && /^Next battle in \d\d:\d\d:\d\d$/.test(s.next), `no Play button; shows "${s.played}" / "${s.next}"`);
  await page.screenshot({ path: `${OUT}/site-played.png`, fullPage: true });

  await page.reload();
  await sleep(1000);
  s = await shown(page);
  check(!s.canPlay && s.wins === '1', 'reloading the same day keeps it locked, stats saved');

  // The whole build is shared, including moves and items, regardless of time.
  const other = await browser.newContext();
  await mockWordle(other);
  const otherPage = await other.newPage();
  await otherPage.clock.setFixedTime(at(DAY1, '22:00:00'));
  await otherPage.goto(server.url);
  await revealAndPlay(otherPage);
  check(JSON.stringify(readParty((await getStatus(otherPage)).mem).party.map((m) => m.species)) === team1, 'everyone gets the same team on the same day');
  const buildKey = party => JSON.stringify(party.map(({ species, moves, heldItem, ivs, evs, nature, abilityNum }) =>
    ({ species, moves, heldItem, ivs, evs, nature, abilityNum })));
  check(buildKey(readParty((await getStatus(otherPage)).mem).party) === buildKey(firstParty),
    'everyone gets identical moves, items, IVs, EVs, nature and ability throughout the day');
  await other.close();

  // Day 2: play again, lose.
  await page.clock.setFixedTime(at(DAY2));
  await page.reload();
  await sleep(1000);
  s = await shown(page);
  check(s.canPlay && s.winStreak === '1' && s.dayStreak === '1', `next day: the Wordle question is back, streaks kept (${statLine(s)})`);
  const preview2 = await revealAndPlay(page, 'yes');
  const secondParty = readParty((await getStatus(page)).mem).party;
  const team2 = JSON.stringify(secondParty.map((m) => m.species));
  check(JSON.stringify(preview2) === team2, 'the yes path reveals the same team the ROM uses');
  check(team2 !== team1, "a new day brings a new team");
  check(secondParty.slice(0, 5).every((m, i) => m.speciesName[0].toLowerCase() === WORDS[DAY2][i])
    && isLegendary(secondParty[5]) && teamBaseStatTotal(secondParty) >= 2700,
  `repeated-letter team spells ${WORDS[DAY2].toUpperCase()} and reaches 2700`);
  await startRedBattle(page);
  await forceLoss(page);
  check(await finishDailyGame(page, 'site-loss'), 'after a loss the site closes the game and returns to the title card');
  s = await shown(page);
  check(s.wins === '1' && s.losses === '1' && s.winStreak === '0' && s.dayStreak === '2', `loss recorded (${statLine(s)})`);
  check(s.played === 'RED won today.', `shows "${s.played}"`);

  // Day 3: leave in the middle of the battle -> counts as a loss.
  await page.clock.setFixedTime(at(DAY3));
  await page.reload();
  await revealAndPlay(page);
  await startRedBattle(page);
  await sleep(1000);
  await page.reload();
  await sleep(1000);
  s = await shown(page);
  check(s.losses === '2' && s.dayStreak === '3' && !s.canPlay && s.played === 'RED won today.', `leaving mid-battle counts as a loss (${statLine(s)})`);

  // Day 5: a missed day resets the streaks.
  await page.clock.setFixedTime(at(DAY5));
  await page.reload();
  await sleep(800);
  s = await shown(page);
  check(s.canPlay && s.winStreak === '0' && s.dayStreak === '0' && s.wins === '1' && s.losses === '2', `missing a day resets the streaks (${statLine(s)})`);
  await revealAndPlay(page);
  const repeatParty = readParty((await getStatus(page)).mem).party;
  check(repeatParty.slice(0, 5).every((m) => m.speciesName[0] === 'Z')
    && new Set(repeatParty.slice(0, 5).map((m) => m.species)).size < 5
    && isLegendary(repeatParty[5]) && teamBaseStatTotal(repeatParty) >= 2700,
  'when distinct species cannot qualify, repeated-letter species may repeat');

  // Practice runs (?seed=) ignore the daily limit and never touch the stats.
  await page.clock.setFixedTime(at(DAY3));
  await page.goto(`${server.url}/?seed=777`);
  await sleep(800);
  check(await page.locator('#practice-note').isVisible() && await page.locator('#play').isVisible(), 'practice run: Play is available, with a note');
  const before = JSON.stringify(await saved(page));
  await page.click('#play');
  await attach(page);
  await startRedBattle(page);
  await sleep(1000);
  check(JSON.stringify(await saved(page)) === before, 'practice battles are not recorded');
  check(errors.length === 0, `no page errors (${errors.join('; ') || 'none'})`);
  await context.close();

  // Phone: layout and touch controls.
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await mockWordle(phoneContext);
  const phone = await phoneContext.newPage();
  await phone.goto(server.url);
  await sleep(1000);
  // Viewport-only screenshots: a fullPage capture resizes the viewport, which
  // makes Chromium drop the emulated touch pointer for the rest of the page.
  await phone.screenshot({ path: `${OUT}/site-phone-title.png` });
  check(await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 0, 'no horizontal scrolling on a phone');
  const fits = await phone.evaluate(() => {
    const card = document.querySelector('.card-title').getBoundingClientRect();
    return [...document.querySelectorAll('.card-title > :not(.snow):not([hidden])')].every((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= card.top - 1 && r.bottom <= card.bottom + 1;
    });
  });
  check(fits, 'the title card fits inside the phone-sized screen');
  check(await phone.locator('.pad').isVisible(), 'touch controls are shown on a phone');
  await phone.click('#wordle-yes');
  await phone.waitForFunction(() => document.querySelector('.app').dataset.state === 'reveal');
  await phone.screenshot({ path: `${OUT}/site-phone-reveal.png` });
  check(await phone.evaluate(() => {
    const screen = document.querySelector('.screen').getBoundingClientRect();
    return [...document.querySelectorAll('.card-reveal > *')].every((el) => {
      const box = el.getBoundingClientRect();
      return box.top >= screen.top - 1 && box.bottom <= screen.bottom + 1;
    });
  }), 'the reveal fits inside the phone-sized screen');
  await phone.click('#reveal-play');
  await attach(phone);
  await sleep(1500);
  const startY = (await getStatus(phone)).y;
  const dpad = await phone.locator('.dpad').boundingBox();
  await phone.mouse.move(dpad.x + dpad.width / 2, dpad.y + 10); // top arm of the d-pad
  await phone.mouse.down();
  await sleep(600);
  await phone.mouse.up();
  await sleep(600);
  const endY = (await getStatus(phone)).y;
  check(endY < startY, `touch d-pad moves the player (y ${startY} -> ${endY})`);
  await phone.screenshot({ path: `${OUT}/site-phone-playing.png` });
  await phoneContext.close();

  // A failed download shows the error card, and Try again recovers.
  const brokenContext = await browser.newContext();
  await mockWordle(brokenContext);
  const broken = await brokenContext.newPage();
  await broken.route('**/game/dailyred.gba.gz', (route) => route.fulfill({ status: 404, body: 'missing' }));
  await broken.goto(server.url);
  await broken.click('#wordle-yes');
  await broken.waitForFunction(() => document.querySelector('.app').dataset.state === 'reveal');
  await broken.click('#reveal-play');
  await broken.waitForFunction(() => document.querySelector('.app').dataset.state === 'error');
  const message = await broken.locator('#error-text').textContent();
  check(message.includes('HTTP 404'), `download failure shows an error ("${message}")`);
  await broken.unroute('**/game/dailyred.gba.gz');
  await broken.click('#retry');
  await attach(broken);
  check(true, 'Try again starts the game after the error');
  await brokenContext.close();

  const wordleContext = await browser.newContext();
  const failWordle = (route) => route.fulfill({ status: 503, body: 'unavailable' });
  await wordleContext.route('**/api/wordle/*', failWordle);
  const wordlePage = await wordleContext.newPage();
  await wordlePage.clock.setFixedTime(at(DAY1));
  await wordlePage.goto(server.url);
  await wordlePage.click('#wordle-yes');
  await wordlePage.waitForFunction(() => document.querySelector('.app').dataset.state === 'error');
  check((await wordlePage.locator('#error-text').textContent()).includes('Wordle'), 'Wordle failure shows a retryable error');
  await wordleContext.unroute('**/api/wordle/*', failWordle);
  await mockWordle(wordleContext);
  await wordlePage.click('#retry');
  await wordlePage.waitForFunction(() => document.querySelector('.app').dataset.state === 'reveal');
  check(await wordlePage.locator('#reveal-word').textContent() === WORDS[DAY1], 'Wordle retry reaches the reveal');
  await wordleContext.close();
} catch (err) {
  failures++;
  console.log('FAIL ', err.message);
} finally {
  await browser.close();
  server.close();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
