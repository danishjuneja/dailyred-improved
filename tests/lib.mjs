// Shared helpers for the headless browser tests: a static server, Chrome via
// playwright-core, booting the real ROM through the same emulator the website
// uses, pressing buttons, and reading game RAM out of a save state.
import { chromium } from 'playwright-core';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const GAME_DIR = join(ROOT, 'pokefirered');
export const ELF = join(GAME_DIR, 'pokefirered_modern.elf');

const CHROME_PATHS = [
  process.env.CHROME_PATH,
  process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
  process.env['PROGRAMFILES(X86)'] && join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'),
  process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, 'Microsoft/Edge/Application/msedge.exe'),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

export function findChrome() {
  const path = CHROME_PATHS.find((p) => existsSync(p));
  if (!path) throw new Error('Chrome or Edge not found. Set CHROME_PATH to a Chrome/Chromium/Edge binary.');
  return path;
}

// Serves web/ on a free port; the server is killed when this process exits.
export async function startServer() {
  const server = spawn(process.execPath, [join(ROOT, 'scripts/serve.mjs'), '0'], { stdio: ['ignore', 'pipe', 'inherit'] });
  process.on('exit', () => server.kill());
  const url = await new Promise((ok, fail) => {
    server.stdout.once('data', (line) => ok(String(line).match(/http:\/\/\S+/)[0]));
    server.once('exit', (code) => fail(new Error(`server exited with ${code}`)));
  });
  return { url, close: () => server.kill() };
}

export async function launchBrowser() {
  return chromium.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  });
}

// Boots the ROM in a bare page (no website UI) with an optional seed. By
// default the game deals a new team after each battle; daily: true plays the
// website's daily game instead (one battle, starting from wins / battles).
// The emulator instance is exposed as window.emu.
export async function bootGame(page, baseUrl, { seed, daily = false, wins = 0, battles = 0, word = 'yodel', species = null } = {}) {
  await page.goto(`${baseUrl}/__test__`);
  await page.setContent('<canvas id="screen" width="480" height="320" style="display:block"></canvas>');
  await page.evaluate(async ({ seed, daily, wins, battles, word, species }) => {
    const { Nostalgist } = await import('/vendor/nostalgist.js');
    const { injectConfig } = await import('/rom-config.js');
    const { loadGameFiles } = await import('/game-files.js');
    const files = await loadGameFiles();
    const rom = seed ? injectConfig(files.rom, { seed, daily, wins, battles, word, species }) : files.rom;
    window.emu = await Nostalgist.launch({
      core: 'mgba',
      element: document.getElementById('screen'),
      rom: { fileName: 'dailyred.gba', fileContent: new Blob([rom]) },
      resolveCoreJs: () => files.coreJs,
      resolveCoreWasm: () => files.coreWasm,
      retroarchConfig: { savestate_file_compression: false, savestate_thumbnail_enable: false },
    });
  }, { seed, daily, wins, battles, word, species });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Presses a GBA button: a, b, start, select, up, down, left, right, l, r.
export async function press(page, button, holdMs = 120) {
  await page.evaluate(({ button, holdMs }) => window.emu.press(button, 1, holdMs), { button, holdMs });
  await sleep(80);
}

export async function pressMany(page, buttons, gapMs = 250) {
  for (const b of buttons) {
    await press(page, b);
    await sleep(gapMs);
  }
}

export async function screenshot(page, path) {
  // Nostalgist renames the canvas to #canvas (Emscripten's convention).
  await page.locator('canvas').first().screenshot({ path });
}

// --- Game RAM via save states -------------------------------------------------
// mGBA's save state (GBASerializedState) stores IWRAM at 0x19000 and EWRAM at
// 0x21000; see mgba/include/mgba/internal/gba/serialize.h.
const STATE_IWRAM = 0x19000;
const STATE_EWRAM = 0x21000;

export async function readMemory(page) {
  const b64 = await page.evaluate(async () => {
    const { state } = await window.emu.saveState();
    const buf = new Uint8Array(await state.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  });
  let state = Buffer.from(b64, 'base64');
  // RetroArch wraps the core's state in a "RASTATE" container of chunks
  // ("MEM " + u32 size + data, ...). Unwrap the MEM chunk if present.
  if (state.subarray(0, 7).toString('latin1') === 'RASTATE') {
    let pos = 8;
    while (pos + 8 <= state.length) {
      const id = state.subarray(pos, pos + 4).toString('latin1');
      const size = state.readUInt32LE(pos + 4);
      if (id === 'MEM ') { state = state.subarray(pos + 8, pos + 8 + size); break; }
      pos += 8 + size + ((8 - (size % 8)) % 8);
    }
  }
  if ((state.readUInt32LE(0) & 0xFFFF0000) !== 0x01000000) {
    throw new Error('Unexpected save state format (compressed?)');
  }
  return {
    read(addr, len) {
      if (addr >= 0x02000000 && addr < 0x02040000) return state.subarray(STATE_EWRAM + addr - 0x02000000, STATE_EWRAM + addr - 0x02000000 + len);
      if (addr >= 0x03000000 && addr < 0x03008000) return state.subarray(STATE_IWRAM + addr - 0x03000000, STATE_IWRAM + addr - 0x03000000 + len);
      throw new Error(`address ${addr.toString(16)} is not in RAM`);
    },
  };
}

// Symbol addresses from the built ELF, or a symbol dump from a container build.
let symbolCache;
export function symbols() {
  if (symbolCache) return symbolCache;
  const nm = join(ROOT, '.toolchain/arm-none-eabi/bin/arm-none-eabi-nm');
  const dump = join(ROOT, 'tests/output/rom-symbols.txt');
  const out = existsSync(dump)
    ? readFileSync(dump, 'utf8')
    : execFileSync(existsSync(nm) ? nm : 'arm-none-eabi-nm', [ELF], { encoding: 'utf8', maxBuffer: 64 << 20 });
  symbolCache = new Map();
  for (const line of out.split('\n')) {
    const [addr, , name] = line.trim().split(/\s+/);
    if (name) symbolCache.set(name, parseInt(addr, 16));
  }
  return symbolCache;
}

export function symbol(name) {
  const addr = symbols().get(name);
  if (addr === undefined) throw new Error(`symbol ${name} not found in ${ELF}`);
  return addr;
}

// --- Game status ----------------------------------------------------------------
const MAP_OFFSET = 7;        // object coordinates are stored with this offset
const OBJECT_EVENT_SIZE = 0x24;

// What the game is doing right now, read from RAM.
export async function getStatus(page) {
  const mem = await readMemory(page);
  const callback2 = mem.read(symbol('gMain') + 4, 4).readUInt32LE(0) & ~1; // strip the Thumb bit
  const objectEventId = mem.read(symbol('gPlayerAvatar') + 5, 1)[0];
  const coords = mem.read(symbol('gObjectEvents') + objectEventId * OBJECT_EVENT_SIZE + 0x10, 4);
  return {
    mem,
    inBattle: callback2 === symbol('BattleMainCB2'),
    inOverworld: callback2 === symbol('CB2_Overworld'),
    x: coords.readInt16LE(0) - MAP_OFFSET,
    y: coords.readInt16LE(2) - MAP_OFFSET,
  };
}

export async function waitFor(page, predicate, { timeoutMs = 20000, intervalMs = 500, what = 'condition' } = {}) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const status = await getStatus(page);
    if (predicate(status)) return status;
    await sleep(intervalMs);
  }
  throw new Error(`timed out waiting for ${what}`);
}

// Walks the player through a list of [x, y] waypoints (straight lines only),
// checking the real position after every step.
export async function walkTo(page, waypoints) {
  for (const [tx, ty] of waypoints) {
    for (let tries = 0; tries < 40; tries++) {
      const { x, y } = await getStatus(page);
      if (x === tx && y === ty) break;
      const dir = tx > x ? 'right' : tx < x ? 'left' : ty > y ? 'down' : 'up';
      await page.evaluate((d) => window.emu.pressDown(d), dir);
      await sleep(200);
      await page.evaluate((d) => window.emu.pressUp(d), dir);
      await sleep(250);
      if (tries === 39) throw new Error(`could not reach ${tx},${ty} (stuck at ${x},${y})`);
    }
  }
}

// Turns to face a direction without moving (a short tap only turns).
export async function face(page, dir) {
  await page.evaluate((d) => window.emu.press(d, 1, 40), dir);
  await sleep(300);
}

// Writes bytes into game RAM by editing a save state and loading it back.
// Used by tests to force battle outcomes quickly. writes: [{ addr, bytes }]
export async function patchMemory(page, writes) {
  await page.evaluate(async (writes) => {
    const { state } = await window.emu.saveState();
    const buf = new Uint8Array(await state.arrayBuffer());
    let mem = 0;
    if (String.fromCharCode(...buf.subarray(0, 7)) === 'RASTATE') {
      for (let pos = 8; pos + 8 <= buf.length;) {
        const id = String.fromCharCode(...buf.subarray(pos, pos + 4));
        const size = new DataView(buf.buffer).getUint32(pos + 4, true);
        if (id === 'MEM ') { mem = pos + 8; break; }
        pos += 8 + size + ((8 - (size % 8)) % 8);
      }
    }
    for (const { addr, bytes } of writes) {
      const off = addr >= 0x03000000 ? 0x19000 + addr - 0x03000000 : 0x21000 + addr - 0x02000000;
      buf.set(bytes, mem + off);
    }
    await window.emu.loadState(new Blob([buf]));
  }, writes);
  await sleep(500); // RetroArch can't save another state right after loading one
}

export const u16 = (n) => [n & 0xFF, (n >> 8) & 0xFF];

// Reads a script variable (VAR_xxxx) from SaveBlock1.
export function readVar(mem, varId) {
  const saveBlock1 = mem.read(symbol('gSaveBlock1Ptr'), 4).readUInt32LE(0);
  return mem.read(saveBlock1 + 0x1000 + (varId - 0x4000) * 2, 2).readUInt16LE(0);
}

// --- Forcing battle results (tests only) ------------------------------------------
// Call while the battle's turn menu is up. These edit HP in RAM so the next
// exchange ends the battle: a win (RED's active Pokemon at 1 HP and the rest of
// his team fainted, ours unkillable with a move that always does 100) or a
// loss (our active Pokemon at 1 HP and the rest of our team fainted).
const MON_SIZE = 100, MON_HP = 86;                                    // struct Pokemon
const BMON_SIZE = 0x58, BMON_MOVES = 0x0C, BMON_PP = 0x24, BMON_HP = 0x28, BMON_MAXHP = 0x2C; // struct BattlePokemon
const MOVE_SEISMIC_TOSS = 69;

export async function forceWin(page) {
  const { mem } = await getStatus(page);
  const activeSlot = mem.read(symbol('gBattlerPartyIndexes') + 2, 2).readUInt16LE(0); // battler 1 = RED
  const enemy = symbol('gEnemyParty'), mons = symbol('gBattleMons');
  await patchMemory(page, [
    ...[0, 1, 2, 3, 4, 5].filter((i) => i !== activeSlot).map((i) => ({ addr: enemy + i * MON_SIZE + MON_HP, bytes: u16(0) })),
    { addr: mons + BMON_SIZE + BMON_HP, bytes: u16(1) },
    { addr: mons + BMON_HP, bytes: u16(999) },
    { addr: mons + BMON_MAXHP, bytes: u16(999) },
    { addr: mons + BMON_MOVES, bytes: u16(MOVE_SEISMIC_TOSS) },
    { addr: mons + BMON_PP, bytes: [20] },
  ]);
}

export async function forceLoss(page) {
  const { mem } = await getStatus(page);
  const activeSlot = mem.read(symbol('gBattlerPartyIndexes'), 2).readUInt16LE(0); // battler 0 = us
  const party = symbol('gPlayerParty'), mons = symbol('gBattleMons');
  await patchMemory(page, [
    ...[0, 1, 2, 3, 4, 5].filter((i) => i !== activeSlot).map((i) => ({ addr: party + i * MON_SIZE + MON_HP, bytes: u16(0) })),
    { addr: mons + BMON_HP, bytes: u16(1) },
  ]);
}

// From the start tile: climb to RED, talk, and wait for the battle's turn menu.
export async function startRedBattle(page) {
  await walkTo(page, [[9, 12]]);
  await face(page, 'up');
  await press(page, 'a');
  for (let i = 0; i < 20 && !(await getStatus(page)).inBattle; i++) {
    await sleep(500);
    await press(page, 'a');
  }
  if (!(await getStatus(page)).inBattle) throw new Error('battle did not start');
  for (let i = 0; i < 12; i++) { await sleep(700); await press(page, 'a'); }
  await press(page, 'b'); // back out of FIGHT if we entered it
  await sleep(500);
}

// The game's status block for the website (sStatus in src/dailyred.c), found
// in EWRAM by its magic bytes: { phase, result }.
export function readGameStatus(mem) {
  const ewram = mem.read(0x02000000, 0x40000);
  const at = ewram.indexOf('DAILYRED-STATUS1', 0, 'latin1');
  return at < 0 ? null : { phase: ewram[at + 20], result: ewram[at + 21] };
}
