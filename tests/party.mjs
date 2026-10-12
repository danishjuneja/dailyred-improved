// Decodes Gen 3 party Pokemon (struct Pokemon, 100 bytes) from raw RAM.
// Names come from the decomp's own constants headers.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR, symbol } from './lib.mjs';

function readConstants(file, prefix) {
  const names = new Map();
  const text = readFileSync(join(GAME_DIR, file), 'utf8');
  for (const m of text.matchAll(new RegExp(`^#define ${prefix}(\\w+)\\s+(\\d+)\\b`, 'gm'))) {
    if (!names.has(Number(m[2]))) names.set(Number(m[2]), m[1]);
  }
  return names;
}

export const SPECIES = readConstants('include/constants/species.h', 'SPECIES_');
export const MOVES = readConstants('include/constants/moves.h', 'MOVE_');
export const ITEMS = readConstants('include/constants/items.h', 'ITEM_');
const NATURES = ['Hardy', 'Lonely', 'Brave', 'Adamant', 'Naughty', 'Bold', 'Docile', 'Relaxed', 'Impish', 'Lax',
  'Timid', 'Hasty', 'Serious', 'Jolly', 'Naive', 'Modest', 'Mild', 'Quiet', 'Bashful', 'Rash', 'Calm', 'Gentle',
  'Sassy', 'Careful', 'Quirky'];

// Order of the four 12-byte substructures (Growth, Attacks, EVs, Misc) by personality % 24.
const ORDERS = ['GAEM', 'GAME', 'GEAM', 'GEMA', 'GMAE', 'GMEA', 'AGEM', 'AGME', 'AEGM', 'AEMG', 'AMGE', 'AMEG',
  'EGAM', 'EGMA', 'EAGM', 'EAMG', 'EMGA', 'EMAG', 'MGAE', 'MGEA', 'MAGE', 'MAEG', 'MEGA', 'MEAG'];

export function decodeMon(bytes) {
  const buf = Buffer.from(bytes);
  const personality = buf.readUInt32LE(0);
  const otId = buf.readUInt32LE(4);
  if (personality === 0 && otId === 0) return null;

  const key = (personality ^ otId) >>> 0;
  const secure = Buffer.alloc(48);
  for (let i = 0; i < 48; i += 4) secure.writeUInt32LE((buf.readUInt32LE(32 + i) ^ key) >>> 0, i);
  const order = ORDERS[personality % 24];
  const sub = (letter) => secure.subarray(order.indexOf(letter) * 12, order.indexOf(letter) * 12 + 12);
  const g = sub('G'), a = sub('A'), e = sub('E'), m = sub('M');

  const ivWord = m.readUInt32LE(4);
  const ivs = [0, 5, 10, 15, 20, 25].map((s) => (ivWord >>> s) & 31); // HP Atk Def Spe SpA SpD
  const species = g.readUInt16LE(0);
  return {
    species,
    speciesName: SPECIES.get(species) ?? `#${species}`,
    heldItem: g.readUInt16LE(2),
    moves: [0, 2, 4, 6].map((o) => a.readUInt16LE(o)),
    moveNames: [0, 2, 4, 6].map((o) => a.readUInt16LE(o)).filter(Boolean).map((id) => MOVES.get(id) ?? `#${id}`),
    pp: [8, 9, 10, 11].map((o) => a[o]),
    evs: [...e.subarray(0, 6)],
    ivs,
    nature: NATURES[personality % 25],
    abilityNum: (ivWord >>> 31) & 1,
    metLocation: m[1],
    fateful: (m.readUInt32LE(8) >>> 31) === 1, // top bit of the ribbons word
    level: buf[84],
    hp: buf.readUInt16LE(86),
    maxHp: buf.readUInt16LE(88),
    stats: [88, 90, 92, 94, 96, 98].map((o) => buf.readUInt16LE(o)), // HP Atk Def Spe SpA SpD
    shiny: ((otId >>> 16) ^ (otId & 0xFFFF) ^ (personality >>> 16) ^ (personality & 0xFFFF)) < 8,
  };
}

export function readParty(memory, side = 'Player') {
  const base = symbol(`g${side}Party`);
  const count = memory.read(symbol(`g${side}PartyCount`), 1)[0];
  const party = [];
  for (let i = 0; i < 6; i++) party.push(decodeMon(memory.read(base + i * 100, 100)));
  return { count, party };
}

export function formatMon(mon) {
  if (!mon) return '(empty)';
  const evTotal = mon.evs.reduce((x, y) => x + y, 0);
  return `${mon.speciesName.padEnd(11)} (${String(baseStatTotal(mon.species)).padStart(3)}) Lv${mon.level} ${mon.nature.padEnd(7)} HP ${mon.hp}/${mon.maxHp}`
    + ` IV ${mon.ivs.join('/')} EV ${mon.evs.join('/')} (${evTotal})${mon.shiny ? ' SHINY' : ''}`
    + ` @ ${ITEMS.get(mon.heldItem) ?? 'no item'}`
    + `\n             ${mon.moveNames.join(', ')}`;
}

// --- Learnsets, parsed from the decomp's data files ----------------------------
// Used to check that every generated move is one the species can really learn
// (by level-up or TM/HM), independently of the C generator.
let learnsets;

// Keeps only the FIRERED side of `#if defined(FIRERED)` / `#elif defined(LEAFGREEN)`
// blocks (Deoxys has a different form, and learnset, in each version).
function fireRedOnly(text) {
  const out = [];
  const stack = [];
  for (const line of text.split('\n')) {
    const directive = line.match(/^\s*#\s*(if|ifdef|elif|else|endif)\b(.*)/);
    if (!directive) {
      if (stack.every(Boolean)) out.push(line);
      continue;
    }
    const [, kind, rest] = directive;
    const cond = rest.includes('FIRERED') ? true : rest.includes('LEAFGREEN') ? false : true;
    if (kind === 'if' || kind === 'ifdef') stack.push(cond);
    else if (kind === 'elif') stack[stack.length - 1] = cond && !stack.at(-1);
    else if (kind === 'else') stack[stack.length - 1] = !stack.at(-1);
    else stack.pop();
  }
  return out.join('\n');
}

function loadLearnsets() {
  const read = (file) => fireRedOnly(readFileSync(join(GAME_DIR, file), 'utf8'));
  const moveId = new Map([...MOVES].map(([id, name]) => [name, id]));
  for (const m of read('include/constants/moves.h').matchAll(/^#define MOVE_(\w+)\s+(\d+)\b/gm)) moveId.set(m[1], Number(m[2]));

  const levelUpArrays = new Map();
  for (const m of read('src/data/pokemon/level_up_learnsets.h').matchAll(/static const u16 (\w+)\[\] = \{([^}]*)\}/g)) {
    levelUpArrays.set(m[1], [...m[2].matchAll(/MOVE_(\w+)/g)].map((x) => moveId.get(x[1])));
  }
  const levelUp = new Map();
  for (const m of read('src/data/pokemon/level_up_learnset_pointers.h').matchAll(/\[SPECIES_(\w+)\]\s*=\s*(\w+)/g)) {
    levelUp.set(m[1], levelUpArrays.get(m[2]) ?? []);
  }

  const tmTable = read('src/data/party_menu.h').match(/static const u16 sTMHMMoves\[\] =\s*\{([^}]*)\}/)[1];
  const tmMoves = [...tmTable.matchAll(/MOVE_(\w+)/g)].map((x) => moveId.get(x[1]));
  const tmhm = new Map();
  for (const block of read('src/data/pokemon/tmhm_learnsets.h').split(/\n\s*\[SPECIES_/).slice(1)) {
    const name = block.match(/^(\w+)\]/)[1];
    tmhm.set(name, [...block.matchAll(/TMHM\((TM|HM)(\d\d)_/g)].map((x) => tmMoves[(x[1] === 'HM' ? 50 : 0) + Number(x[2]) - 1]));
  }
  return { levelUp, tmhm };
}

export function learnableMoves(species) {
  learnsets ??= loadLearnsets();
  const name = SPECIES.get(species);
  return new Set([...(learnsets.levelUp.get(name) ?? []), ...(learnsets.tmhm.get(name) ?? [])]);
}

// --- Held items: the pools from dailyred_team.c, and move types ----------------
let itemRules;

function loadItemRules() {
  const read = (file) => readFileSync(join(GAME_DIR, file), 'utf8');
  const itemId = new Map([...read('include/constants/items.h').matchAll(/^#define ITEM_(\w+)\s+(\d+)\b/gm)].map((m) => [m[1], Number(m[2])]));
  const team = read('src/dailyred_team.c');
  const general = team.match(/sBattleItems\[\] =\s*\{([^}]*)\}/)[1];
  const boosts = team.match(/sTypeBoostItems\[NUMBER_OF_MON_TYPES\] =\s*\{([^}]*)\}/)[1];
  const boosterType = new Map();
  for (const m of boosts.matchAll(/\[TYPE_(\w+)\]\s*=\s*ITEM_(\w+)/g)) if (m[2] !== 'NONE') boosterType.set(itemId.get(m[2]), m[1]);
  const moveId = new Map([...read('include/constants/moves.h').matchAll(/^#define MOVE_(\w+)\s+(\d+)\b/gm)].map((m) => [m[1], Number(m[2])]));
  const moveInfo = new Map();
  for (const m of read('src/data/battle_moves.h').matchAll(/\[MOVE_(\w+)\]\s*=\s*\{([^}]*)\}/g)) {
    moveInfo.set(moveId.get(m[1]), { power: Number(m[2].match(/\.power = (\d+)/)?.[1] ?? 0), type: m[2].match(/\.type = TYPE_(\w+)/)?.[1] });
  }
  return {
    general: new Set([...general.matchAll(/ITEM_(\w+)/g)].map((m) => itemId.get(m[1]))),
    boosterType,
    moveInfo,
  };
}

// --- Base stat totals, from species_info.h ---------------------------------------
let baseStats;

// Base stats in stat order (HP, Atk, Def, Speed, Sp. Atk, Sp. Def).
export function baseStatsOf(species) {
  baseStatTotal(species);
  return baseStats.get(species);
}

export function baseStatTotal(species) {
  if (!baseStats) {
    baseStats = new Map();
    const text = fireRedOnly(readFileSync(join(GAME_DIR, 'src/data/pokemon/species_info.h'), 'utf8'));
    const ids = new Map([...SPECIES].map(([id, name]) => [name, id]));
    for (const m of readFileSync(join(GAME_DIR, 'include/constants/species.h'), 'utf8').matchAll(/^#define SPECIES_(\w+)\s+(\d+)\b/gm)) ids.set(m[1], Number(m[2]));
    for (const chunk of text.split('[SPECIES_').slice(1)) {
      const fields = ['baseHP', 'baseAttack', 'baseDefense', 'baseSpeed', 'baseSpAttack', 'baseSpDefense'].map((f) => chunk.match(new RegExp(`\\.${f}\\s*=\\s*(\\d+)`)));
      if (fields.every(Boolean)) baseStats.set(ids.get(chunk.split(']')[0]), fields.map((m) => Number(m[1])));
    }
  }
  return baseStats.get(species).reduce((a, b) => a + b, 0);
}

export const teamBaseStatTotal = (party) => party.filter(Boolean).reduce((sum, m) => sum + baseStatTotal(m.species), 0);

// The minimum and the legendary list from dailyred_team.c, so the tests
// always match the game.
const teamSource = readFileSync(join(GAME_DIR, 'src/dailyred_team.c'), 'utf8');
export const MIN_TEAM_BST = Number(teamSource.match(/#define MIN_TEAM_BASE_STAT_TOTAL (\d+)/)[1]);
export const MIN_TEAM_IV = Number(teamSource.match(/#define MIN_TEAM_IV\s+(\d+)/)[1]);

// The EV rule, written independently of the C code: 252 into each of the two
// highest base stats (Attack / Sp. Atk only if an attack with power > 1 uses
// them; ties go Atk, SpA, Speed, HP, Def, SpD) and 6 into HP, or into the
// third-best stat if HP is one of the two.
const PHYSICAL_TYPES = new Set(['NORMAL', 'FIGHTING', 'FLYING', 'POISON', 'GROUND', 'ROCK', 'BUG', 'GHOST', 'STEEL']);
export function expectedEVs(mon) {
  itemRules ??= loadItemRules();
  const base = baseStatsOf(mon.species);
  const usable = [true, false, true, true, false, true];
  for (const id of mon.moves.filter(Boolean)) {
    const info = itemRules.moveInfo.get(id);
    if (info.power > 1) usable[PHYSICAL_TYPES.has(info.type) ? 1 : 4] = true;
  }
  const order = [1, 4, 3, 0, 2, 5].filter((stat) => usable[stat]).sort((a, b) => base[b] - base[a]); // sort is stable
  const evs = [0, 0, 0, 0, 0, 0];
  evs[order[0]] = 252;
  evs[order[1]] = 252;
  evs[order[0] !== 0 && order[1] !== 0 ? 0 : order[2]] = 6;
  return evs;
}
const LEGENDARY_NAMES = new Set([...teamSource.match(/sLegendaries\[\] =\s*\{([^}]*)\}/)[1].matchAll(/SPECIES_(\w+)/g)].map((m) => m[1]));
export const isLegendary = (mon) => LEGENDARY_NAMES.has(mon.speciesName);
export function hasDamagingMove(mon) {
  itemRules ??= loadItemRules();
  return mon.moves.some((id) => id && itemRules.moveInfo.get(id)?.power > 0);
}

// Checks a party read from RAM against the team rules. Returns a list of
// problems (empty when the team is valid).
export function validateTeam({ count, party }) {
  const problems = [];
  if (count !== 6 || !party.every(Boolean)) problems.push(`party has ${count} Pokemon, expected 6`);
  const mons = party.filter(Boolean);
  if (new Set(mons.map((m) => m.species)).size !== mons.length) problems.push('duplicate species');
  const total = teamBaseStatTotal(mons);
  if (total < MIN_TEAM_BST) problems.push(`team base stat total ${total} is under the minimum ${MIN_TEAM_BST}`);
  if (mons.filter(isLegendary).length > 1) problems.push('more than one legendary');
  for (const m of mons) {
    const tag = m.speciesName;
    if (m.species < 1 || m.species > 411 || (m.species >= 252 && m.species <= 276)) problems.push(`${tag}: not a Gen 1-3 species`);
    if (m.level !== 100) problems.push(`${tag}: level ${m.level}`);
    if (m.hp !== m.maxHp || m.hp === 0) problems.push(`${tag}: HP ${m.hp}/${m.maxHp}`);
    if (m.moveNames.length === 0) problems.push(`${tag}: no moves`);
    if (new Set(m.moveNames).size !== m.moveNames.length) problems.push(`${tag}: duplicate moves`);
    const learnable = learnableMoves(m.species);
    for (const move of m.moves.filter(Boolean)) {
      if (!learnable.has(move)) problems.push(`${tag}: can't learn ${MOVES.get(move)}`);
    }
    const expected = Math.min(4, learnable.size);
    if (m.moveNames.length !== expected) problems.push(`${tag}: ${m.moveNames.length} moves, expected ${expected}`);
    const evTotal = m.evs.reduce((a, b) => a + b, 0);
    if (evTotal > 510 || m.evs.some((e) => e > 255)) problems.push(`${tag}: illegal EVs ${m.evs.join('/')}`);
    if (m.ivs.some((iv) => iv < MIN_TEAM_IV || iv > 31)) problems.push(`${tag}: IVs ${m.ivs.join('/')} not all ${MIN_TEAM_IV}-31`);
    const wantEVs = expectedEVs(m);
    if (wantEVs.join('/') !== m.evs.join('/')) problems.push(`${tag}: EVs ${m.evs.join('/')}, expected ${wantEVs.join('/')}`);
    if (m.pp.some((pp, i) => m.moves[i] && pp === 0)) problems.push(`${tag}: a move has 0 PP`);
    itemRules ??= loadItemRules();
    const boostType = itemRules.boosterType.get(m.heldItem);
    if (boostType) {
      const attacks = m.moves.filter(Boolean).map((id) => itemRules.moveInfo.get(id));
      if (!attacks.some((info) => info.power > 1 && info.type === boostType)) problems.push(`${tag}: holds a ${boostType} booster without a ${boostType} attack`);
    } else if (!itemRules.general.has(m.heldItem) && ![
      'CHOICE_BAND', 'CHESTO_BERRY', 'LIGHT_BALL', 'THICK_CLUB', 'SOUL_DEW', 'DEEP_SEA_TOOTH',
    ].includes(ITEMS.get(m.heldItem))) {
      problems.push(`${tag}: held item ${m.heldItem} isn't in the item pool`);
    }
    const item = ITEMS.get(m.heldItem);
    if (item === 'CHOICE_BAND' && !(m.moves.filter((id) => {
      const info = itemRules.moveInfo.get(id);
      return info?.power > 1 && PHYSICAL_TYPES.has(info.type);
    }).length >= 3 && m.moves.filter(Boolean).every((id) => {
      const info = itemRules.moveInfo.get(id);
      return (info?.power > 1 && PHYSICAL_TYPES.has(info.type))
        || ['TOXIC', 'THUNDER_WAVE', 'ENCORE'].includes(MOVES.get(id));
    }))) problems.push(`${tag}: Choice Band needs physical coverage without recovery or setup`);
    if (item === 'CHESTO_BERRY' && !m.moveNames.includes('REST')) problems.push(`${tag}: Chesto Berry without Rest`);
    const owners = { LIGHT_BALL: ['PIKACHU'], THICK_CLUB: ['CUBONE', 'MAROWAK'],
      SOUL_DEW: ['LATIAS', 'LATIOS'], DEEP_SEA_TOOTH: ['CLAMPERL'] };
    if (owners[item] && !owners[item].includes(m.speciesName)) problems.push(`${tag}: wrong species for ${item}`);
    if (!m.fateful) problems.push(`${tag}: not marked as an event Pokemon (Mew/Deoxys would disobey)`);
  }
  return problems;
}
