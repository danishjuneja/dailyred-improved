// End-to-end smoke test: boots the real ROM in headless Chrome through the
// website's emulator and checks the whole game loop.
//
//   cd tests && npm install && npm test
//
// Screenshots are written to tests/output/ for a visual check.
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GAME_DIR, startServer, launchBrowser, bootGame, sleep, press, screenshot,
  getStatus, waitFor, walkTo, face, patchMemory, readVar, symbol, u16,
  startRedBattle, forceWin, readGameStatus,
} from './lib.mjs';
import { readParty, formatMon, validateTeam } from './party.mjs';

const OUT = fileURLToPath(new URL('./output/', import.meta.url));
mkdirSync(OUT, { recursive: true });

function define(file, name) {
  const m = readFileSync(join(GAME_DIR, file), 'utf8').match(new RegExp(`#define ${name}\\s+(\\w+)`));
  if (!m) throw new Error(`${name} not found in ${file}`);
  return Number(m[1]);
}
const VAR_BATTLES = define('include/constants/vars.h', 'VAR_DAILYRED_BATTLES');
const VAR_WINS = define('include/constants/vars.h', 'VAR_DAILYRED_WINS');
const TERRAIN_MOUNTAIN = define('include/constants/battle.h', 'BATTLE_TERRAIN_MOUNTAIN');
const STYLE_SET = define('include/constants/global.h', 'OPTIONS_BATTLE_STYLE_SET');
const LOCALID_RED = define('include/constants/map_event_ids.h', 'LOCALID_DAILYRED_RED');
const DIR_NORTH = define('include/constants/global.h', 'DIR_NORTH');
const SPECIES_PIKACHU = define('include/constants/species.h', 'SPECIES_PIKACHU');
const MOVE_SEISMIC_TOSS = define('include/constants/moves.h', 'MOVE_SEISMIC_TOSS');
const START = [define('include/constants/dailyred.h', 'DAILYRED_START_X'), define('include/constants/dailyred.h', 'DAILYRED_START_Y')];
const RED_FRONT = [9, 12]; // the tile below RED, at the top of the stairs

const MON_SIZE = 100, MON_HP = 86;          // struct Pokemon
const BMON_SIZE = 0x58, BMON_MOVES = 0x0C, BMON_PP = 0x24, BMON_HP = 0x28, BMON_MAXHP = 0x2C; // struct BattlePokemon
const BATTLE_STYLE_OFFSET = 29; // gBattleScripting.battleStyle

// Direction RED's overworld object faces (struct ObjectEvent: localId at 0x08,
// facingDirection in the low 4 bits of 0x18).
function redFacing(mem) {
  for (let i = 0; i < 16; i++) {
    const obj = mem.read(symbol('gObjectEvents') + i * 0x24, 0x24);
    if ((obj[0] & 1) && obj[8] === LOCALID_RED) return obj[0x18] & 0xF;
  }
  return -1;
}

// Options are bitfields in the u16 at SaveBlock2 + 0x14; battle style is bit 9.
function optionsBattleStyle(mem) {
  const saveBlock2 = mem.read(symbol('gSaveBlock2Ptr'), 4).readUInt32LE(0);
  return (mem.read(saveBlock2 + 0x14, 2).readUInt16LE(0) >> 9) & 1;
}

let failures = 0;
function check(ok, message) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${message}`);
  if (!ok) failures++;
}

const teamKey = (party) => party.map((m) => m && `${m.species}:${m.moves.join(',')}`).join('|');

function checkTeam(label, team) {
  const problems = validateTeam(team);
  check(problems.length === 0, `${label}: valid team (6 different Gen 1-3 species, level 100, learnable moves, legal stats, held items)${problems.length ? ': ' + problems.join('; ') : ''}`);
}

async function talkToRed(page) {
  await walkTo(page, [RED_FRONT]);
  await face(page, 'up');
  await press(page, 'a');
  for (let i = 0; i < 20; i++) {
    const s = await getStatus(page);
    if (s.inBattle) return s;
    await press(page, 'a');
    await sleep(500);
  }
  throw new Error('battle did not start');
}

// Mashes A through the battle and the post-battle messages until the next run
// has started: back at the start tile with the battle counter increased.
async function finishBattle(page, battlesBefore) {
  const end = Date.now() + 120000;
  while (Date.now() < end) {
    for (let i = 0; i < 6; i++) { await press(page, 'a'); await sleep(250); }
    const s = await getStatus(page);
    if (s.inOverworld && s.x === START[0] && s.y === START[1] && readVar(s.mem, VAR_BATTLES) === battlesBefore + 1) return s;
  }
  throw new Error('battle did not finish');
}

async function waitForActionMenu(page) {
  // Battle intro takes a few seconds; press A until the turn menu is up.
  for (let i = 0; i < 12; i++) { await sleep(700); await press(page, 'a'); }
  await press(page, 'b'); // back out of FIGHT if we entered it
  await sleep(500);
}

const server = await startServer();
const browser = await launchBrowser();
let page;
try {
  // 1. Same seed => same team, different seed => different team.
  const teams = {};
  for (const seed of [1001, 1001, 2002]) {
    page = await browser.newPage();
    await bootGame(page, server.url, { seed });
    const s = await waitFor(page, (st) => st.inOverworld, { what: 'overworld' });
    const team = readParty(s.mem);
    (teams[seed] ??= []).push(teamKey(team.party));
    if (teams[seed].length === 1) {
      checkTeam(`seed ${seed}`, team);
      console.log(team.party.map((m) => '      ' + formatMon(m)).join('\n'));
    }
    await page.close();
  }
  check(teams[1001][0] === teams[1001][1], 'same seed gives the same team');
  check(teams[1001][0] !== teams[2002][0], 'different seeds give different teams');

  // 2. Boot, look around, open the menus.
  page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await bootGame(page, server.url, { seed: 424242 });
  let s = await waitFor(page, (st) => st.inOverworld, { what: 'overworld' });
  check(s.x === START[0] && s.y === START[1], `player starts at ${START} (got ${s.x},${s.y})`);
  check(redFacing(s.mem) === DIR_NORTH, 'RED faces away from the player, out over the drop');
  check(optionsBattleStyle(s.mem) === STYLE_SET, 'battle style starts as SET');
  await sleep(1500);
  await screenshot(page, `${OUT}/01-start.png`);
  await press(page, 'start'); await sleep(800);
  await screenshot(page, `${OUT}/02-start-menu.png`);
  await press(page, 'a'); await sleep(2500);
  await screenshot(page, `${OUT}/03-party.png`);
  await press(page, 'a'); await sleep(800);
  await screenshot(page, `${OUT}/04-party-actions.png`);
  await press(page, 'a'); await sleep(2500);
  await screenshot(page, `${OUT}/05-summary.png`);
  await press(page, 'right'); await sleep(800);
  await screenshot(page, `${OUT}/06-summary-stats.png`);
  await press(page, 'right'); await sleep(800);
  await screenshot(page, `${OUT}/07-summary-moves.png`);
  for (const b of ['b', 'b', 'b', 'b']) { await press(page, b); await sleep(1200); }
  s = await waitFor(page, (st) => st.inOverworld, { what: 'back in the overworld' });
  const team1 = readParty(s.mem);

  // Options: Battle Style is locked on SET.
  await press(page, 'start'); await sleep(800);
  await press(page, 'down'); await sleep(300);
  await press(page, 'a'); await sleep(2500);
  await press(page, 'down'); await sleep(300);
  await press(page, 'down'); await sleep(300);
  await press(page, 'right'); await sleep(300);
  await press(page, 'left'); await sleep(300);
  await press(page, 'left'); await sleep(500);
  await screenshot(page, `${OUT}/08-options.png`);
  await press(page, 'b'); await sleep(2500);
  await press(page, 'b'); await sleep(1000);
  s = await waitFor(page, (st) => st.inOverworld, { what: 'back from the options' });
  check(optionsBattleStyle(s.mem) === STYLE_SET, "the Options menu can't switch battle style away from SET");

  // 3. Climb to RED -> trainer battle on the peak. Force a win.
  s = await talkToRed(page);
  check(s.inBattle, 'talking to RED starts a battle');
  check(s.mem.read(symbol('gBattleTerrain'), 1)[0] === TERRAIN_MOUNTAIN, 'battle uses the mountain background');
  check(s.mem.read(symbol('gBattleScripting') + BATTLE_STYLE_OFFSET, 1)[0] === STYLE_SET, 'the battle runs in SET style');
  check(s.mem.read(symbol('gTrainerBattleOpponent_A'), 2).readUInt16LE(0) === define('include/constants/opponents.h', 'TRAINER_DAILYRED_RED'), 'opponent is TRAINER_DAILYRED_RED');
  const red = readParty(s.mem, 'Enemy');
  console.log(red.party.map((m) => '      ' + formatMon(m)).join('\n'));
  check(red.party.map((m) => m?.speciesName).join(',') === 'PIKACHU,ESPEON,SNORLAX,VENUSAUR,CHARIZARD,BLASTOISE', "RED's team is Pikachu, Espeon, Snorlax, Venusaur, Charizard, Blastoise");
  check(red.party.every((m) => m.level === 100 && m.ivs.every((iv) => iv === 31) && m.heldItem !== 0), "RED's Pokemon are level 100 with perfect IVs and held items");
  check(red.party.every((m) => m.evs.reduce((a, b) => a + b, 0) >= 508), "RED's Pokemon have their EV spreads");
  await waitForActionMenu(page);
  await screenshot(page, `${OUT}/09-battle.png`);
  const enemyParty = symbol('gEnemyParty'), battleMons = symbol('gBattleMons');

  // KO RED's lead while the rest of his team is healthy. In SHIFT style the
  // game would now ask "Will LEAF change POKeMON?" and A would open the party
  // menu (leaving the battle screen); in SET style RED just sends the next one.
  await patchMemory(page, [
    { addr: battleMons + BMON_SIZE + BMON_HP, bytes: u16(1) },               // RED's active mon: 1 HP
    { addr: battleMons + BMON_HP, bytes: u16(999) },                         // ours: can't be KO'd
    { addr: battleMons + BMON_MAXHP, bytes: u16(999) },
    { addr: battleMons + BMON_MOVES, bytes: u16(MOVE_SEISMIC_TOSS) },        // a move that always hits for 100
    { addr: battleMons + BMON_PP, bytes: [20] },
  ]);
  let stayedInBattle = true, nextMonOut = false;
  for (let i = 0; i < 60 && !nextMonOut; i++) {
    await press(page, 'a'); await sleep(250);
    const st = await getStatus(page);
    if (!st.inBattle) { stayedInBattle = false; break; }
    nextMonOut = st.mem.read(battleMons + BMON_SIZE, 2).readUInt16LE(0) !== SPECIES_PIKACHU;
  }
  check(nextMonOut && stayedInBattle, 'after RED\'s Pokemon faints he sends the next one with no switch prompt');
  await screenshot(page, `${OUT}/10-next-mon.png`);

  // Now finish: only RED's active Pokemon is left, at 1 HP.
  s = await getStatus(page);
  const activeSlot = s.mem.read(symbol('gBattlerPartyIndexes') + 2, 2).readUInt16LE(0); // battler 1 = RED
  await patchMemory(page, [
    ...[0, 1, 2, 3, 4, 5].filter((i) => i !== activeSlot).map((i) => ({ addr: enemyParty + i * MON_SIZE + MON_HP, bytes: u16(0) })),
    { addr: battleMons + BMON_SIZE + BMON_HP, bytes: u16(1) },
  ]);
  s = await finishBattle(page, 0);
  check(readVar(s.mem, VAR_WINS) === 1 && readVar(s.mem, VAR_BATTLES) === 1, 'win is recorded (1 win / 1 battle)');
  const team2 = readParty(s.mem);
  checkTeam('team after a win', team2);
  check(teamKey(team2.party) !== teamKey(team1.party), 'a new team is generated after the win');
  check(redFacing(s.mem) === DIR_NORTH, 'RED faces the drop again for the next run');
  await screenshot(page, `${OUT}/11-after-win.png`);

  // 4. Battle again and force a loss.
  s = await talkToRed(page);
  check(s.inBattle, 'RED can be battled again');
  await waitForActionMenu(page);
  const playerParty = symbol('gPlayerParty');
  await patchMemory(page, [
    ...[1, 2, 3, 4, 5].map((i) => ({ addr: playerParty + i * MON_SIZE + MON_HP, bytes: u16(0) })),
    { addr: battleMons + BMON_HP, bytes: u16(1) },
  ]);
  s = await finishBattle(page, 1);
  check(readVar(s.mem, VAR_WINS) === 1 && readVar(s.mem, VAR_BATTLES) === 2, 'loss is recorded (1 win / 2 battles), no white-out');
  const team3 = readParty(s.mem);
  checkTeam('team after a loss', team3);
  check(teamKey(team3.party) !== teamKey(team2.party), 'a new team is generated after the loss');
  await screenshot(page, `${OUT}/12-after-loss.png`);

  // 5. The website's daily game: the record carries over from the website,
  //    the game ends after one battle and stays put until the site closes it.
  await page.close();
  page = await browser.newPage();
  await bootGame(page, server.url, { seed: 31337, daily: true, wins: 4, battles: 9 });
  s = await waitFor(page, (st) => st.inOverworld, { what: 'overworld (daily game)' });
  check(readVar(s.mem, VAR_WINS) === 4 && readVar(s.mem, VAR_BATTLES) === 9, "the daily game starts from the website's record (4 wins / 9 battles)");
  await sleep(1000);
  await startRedBattle(page);
  check(readGameStatus((await getStatus(page)).mem)?.phase === 1, 'the game reports that the battle has started');
  const resetKeys = ['a', 'b', 'start', 'select'];
  await page.evaluate((keys) => keys.forEach((k) => window.emu.pressDown(k)), resetKeys);
  await sleep(500);
  await page.evaluate((keys) => keys.forEach((k) => window.emu.pressUp(k)), resetKeys);
  await sleep(3000);
  check((await getStatus(page)).inBattle, 'soft reset (A+B+Start+Select) is off during the daily battle');
  await press(page, 'b'); await sleep(500); // close anything the key combo opened
  await forceWin(page);
  let shot = 0, over = null;
  for (let i = 0; i < 120 && !over; i++) {
    await press(page, 'a'); await sleep(300);
    const st = await getStatus(page);
    if (!st.inBattle) await screenshot(page, `${OUT}/14-daily-end-${String(shot++).padStart(2, '0')}.png`);
    const status = readGameStatus(st.mem);
    if (status?.phase === 3) over = { st, status };
  }
  check(over && over.status.result === 1, 'the game reports the win, then that the daily game is over');
  check(over && readVar(over.st.mem, VAR_WINS) === 5 && readVar(over.st.mem, VAR_BATTLES) === 10, 'the record message counts this battle (5 wins / 10 battles)');
  for (let i = 0; i < 10; i++) { await press(page, 'a'); await sleep(300); }
  s = await getStatus(page);
  const after = readGameStatus(s.mem);
  check(!s.inBattle && after?.phase === 3 && readVar(s.mem, VAR_BATTLES) === 10, 'after the daily game is over, pressing A does nothing (no second battle)');
  await screenshot(page, `${OUT}/15-daily-over.png`);

  // 6. Without a seed (e.g. a desktop emulator) the title screen appears and
  //    pressing Start goes straight into the summit with a team.
  await page.close();
  page = await browser.newPage();
  await bootGame(page, server.url);
  await sleep(4000);
  check(!(await getStatus(page)).inOverworld, 'without a seed the game shows the intro/title first');
  for (let i = 0; i < 40 && !(await getStatus(page)).inOverworld; i++) {
    await press(page, 'start');
    await sleep(600);
  }
  s = await waitFor(page, (st) => st.inOverworld, { what: 'overworld after the title screen' });
  await sleep(1000);
  await screenshot(page, `${OUT}/13-no-seed-start.png`);
  checkTeam('team without a seed', readParty(s.mem));
} catch (err) {
  failures++;
  console.log('FAIL ', err.message);
  if (page) await page.screenshot({ path: `${OUT}/error.png` }).catch(() => {});
} finally {
  await browser.close();
  server.close();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
