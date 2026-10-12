// Real ROM regression tests: useful builds and identical daily loadouts across
// independent browser contexts, records, and time zones.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startServer, launchBrowser, bootGame, waitFor } from './lib.mjs';
import { readParty, SPECIES, MOVES, ITEMS, learnableMoves, formatMon } from './party.mjs';
import { selectDailyTeam } from '../web/team.js';

const ids = new Map([...SPECIES].map(([id, name]) => [name, id]));
const moveData = new Map([...readFileSync(new URL('../pokefirered/src/data/battle_moves.h', import.meta.url), 'utf8')
  .matchAll(/\[MOVE_(\w+)\]\s*=\s*\{([^}]*)\}/g)].map(([, name, body]) => [name, {
    power: Number(body.match(/\.power\s*=\s*(\d+)/)[1]),
    accuracy: Number(body.match(/\.accuracy\s*=\s*(\d+)/)[1]),
    type: body.match(/\.type\s*=\s*TYPE_(\w+)/)[1],
  }]));
// Ordinary attacks with no charging, sleep, recharge, or self-KO requirement.
const dependable = new Set(`SURF WATER_PULSE BUBBLE_BEAM WATER_GUN THUNDERBOLT THUNDER_PUNCH
  SPARK SHOCK_WAVE FLAMETHROWER FIRE_PUNCH FLAME_WHEEL EMBER ICE_BEAM ICE_PUNCH AURORA_BEAM
  PSYCHIC PSYBEAM CONFUSION EXTRASENSORY CRUNCH BITE FAINT_ATTACK DRAGON_CLAW DRAGON_BREATH
  GIGA_DRAIN MAGICAL_LEAF RAZOR_LEAF VINE_WHIP EARTHQUAKE DIG AERIAL_ACE WING_ATTACK DRILL_PECK
  FLY SLUDGE_BOMB SLUDGE SHADOW_BALL LICK BRICK_BREAK LOW_KICK CROSS_CHOP ROCK_SLIDE ROCK_THROW
  ANCIENT_POWER METAL_CLAW STEEL_WING BODY_SLAM STRENGTH HEADBUTT SWIFT SLASH SECRET_POWER
  FACADE TACKLE SCRATCH POUND PECK MEGAHORN SIGNAL_BEAM`.split(/\s+/).filter(name => {
    const m = moveData.get(name);
    return m.power >= 50 && (m.accuracy === 0 || m.accuracy >= 90) && !['DIG', 'FLY'].includes(name);
  }));
const physical = new Set(['NORMAL', 'FIGHTING', 'FLYING', 'POISON', 'GROUND', 'ROCK', 'BUG', 'GHOST', 'STEEL']);
const key = party => party.map(({ species, moves, heldItem, ivs, evs, nature, abilityNum }) =>
  ({ species, moves, heldItem, ivs, evs, nature, abilityNum }));
function checkBuild(mon) {
  const legal = learnableMoves(mon.species);
  assert.ok(mon.moves.filter(Boolean).every(id => legal.has(id)), `${mon.speciesName}: illegal move`);
  assert.equal(new Set(mon.moves.filter(Boolean)).size, mon.moves.filter(Boolean).length);
  const available = [...legal].map(id => MOVES.get(id)).filter(name => dependable.has(name));
  if (available.length >= 2) {
    const attacks = mon.moveNames.slice(0, 2).map(name => moveData.get(name));
    assert.ok(attacks.every((m, i) => ['SEISMIC_TOSS', 'NIGHT_SHADE'].includes(mon.moveNames[i])
      || (m.power >= 50 && (m.accuracy === 0 || m.accuracy >= 90))),
      `${mon.speciesName}: lacks two dependable attacks: ${mon.moveNames}`);
    if (new Set(available.map(name => moveData.get(name).type)).size >= 2) {
      assert.notEqual(attacks[0].type, attacks[1].type, `${mon.speciesName}: redundant primary coverage`);
    }
  }
  const item = ITEMS.get(mon.heldItem);
  if (item === 'CHOICE_BAND') assert.ok(mon.moveNames.filter(name => {
    const m = moveData.get(name);
    return m.power > 1 && physical.has(m.type);
  }).length >= 3 && mon.moveNames.every(name => {
    const m = moveData.get(name);
    return (m.power > 1 && physical.has(m.type)) || ['TOXIC', 'THUNDER_WAVE', 'ENCORE'].includes(name);
  }), `${mon.speciesName}: unsuitable Choice Band`);
  if (item === 'CHOICE_BAND') assert.ok(mon.stats[1] >= mon.stats[4], 'Choice Band on a special-leaning build');
  if (item === 'CHESTO_BERRY') assert.ok(mon.moveNames.includes('REST'));
  if (mon.moveNames.includes('REST')) assert.equal(item, 'CHESTO_BERRY');
  if (mon.moveNames.includes('PROTECT') && mon.moveNames.includes('TOXIC')
    && !mon.moveNames.includes('REST')
    && !['PIKACHU', 'CUBONE', 'MAROWAK', 'LATIAS', 'LATIOS', 'CLAMPERL'].includes(mon.speciesName)) {
    assert.equal(item, 'LEFTOVERS', `${mon.speciesName}: Toxic/Protect should favour sustained recovery`);
  }
  assert.ok(!mon.moveNames.includes('SLEEP_TALK') || mon.moveNames.includes('REST'));
}

const server = await startServer();
const browser = await launchBrowser();
async function generate(species, seed, record = false) {
  const context = await browser.newContext({ timezoneId: record ? 'Asia/Kolkata' : 'America/New_York' });
  try {
    const page = await context.newPage();
    const word = species.slice(0, 5).map(id => SPECIES.get(id)[0].toLowerCase()).join('');
    await bootGame(page, server.url, { seed, daily: true, species, word, wins: record ? 8 : 0, battles: record ? 13 : 0 });
    const { mem } = await waitFor(page, s => s.inOverworld, { timeoutMs: 30000 });
    const { party } = readParty(mem);
    assert.deepEqual(party.map(mon => mon.species), species);
    return party;
  } finally { await context.close(); }
}
try {
  const daily = selectDailyTeam('yodel', 12345).species.map(mon => mon.id);
  const a = await generate(daily, 12345);
  const b = await generate(daily, 12345, true);
  assert.deepEqual(key(a), key(b), 'daily builds differ between players');
  console.log('PASS identical complete daily builds across independent players, records, and time zones');
  a.forEach(checkBuild);
  const c = await generate(daily, 54321);
  c.forEach(checkBuild);
  assert.notDeepEqual(key(a), key(c), 'different daily seeds should retain build variety');
  const squads = [
    ['CHARIZARD', 'ALAKAZAM', 'SNORLAX', 'GENGAR', 'FERALIGATR', 'MEWTWO'],
    ['LAPRAS', 'VENUSAUR', 'HERACROSS', 'PIKACHU', 'SLAKING', 'LUGIA'],
    ['DITTO', 'UNOWN', 'WOBBUFFET', 'MAGIKARP', 'SMEARGLE', 'KYOGRE'],
    ['BUTTERFREE', 'ZUBAT', 'YANMA', 'IVYSAUR', 'ZANGOOSE', 'REGIROCK'],
    ['HERACROSS', 'PINSIR', 'MACHAMP', 'PRIMEAPE', 'SCYTHER', 'REGIROCK'],
    ['HERACROSS', 'PINSIR', 'MACHAMP', 'PRIMEAPE', 'SCYTHER', 'REGIROCK'],
    ['HERACROSS', 'PINSIR', 'MACHAMP', 'PRIMEAPE', 'SCYTHER', 'REGIROCK'],
  ];
  let bandWithUtility = 0;
  for (const [index, names] of squads.entries()) {
    const party = await generate(names.map(name => ids.get(name)), 6789 + index);
    party.forEach(checkBuild);
    bandWithUtility += party.filter(mon => ITEMS.get(mon.heldItem) === 'CHOICE_BAND'
      && mon.moveNames.some(name => moveData.get(name).power === 0)).length;
    console.log(`PASS ${names.join(', ')}`);
    for (const mon of party) console.log(formatMon(mon));
  }
  assert.ok(bandWithUtility > 0, 'physical attackers with a utility move should receive Choice Band');
} finally {
  await browser.close();
  server.close();
}
