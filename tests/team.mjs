import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { dailySeed } from '../web/daily.js';
import { SPECIES } from '../web/species-data.js';
import { selectDailyTeam } from '../web/team.js';
import { learnableMoves, MOVES } from './party.mjs';

const total = (team) => team.species.reduce((sum, mon) => sum + mon.baseStats, 0);

test('catalogue covers the FireRed Gen 1–3 species and all letters', () => {
  assert.equal(SPECIES.length, 386);
  for (const letter of 'abcdefghijklmnopqrstuvwxyz') {
    assert.ok(SPECIES.some((species) => !species[3] && species[1].startsWith(letter.toUpperCase())), letter);
  }
  assert.deepEqual(SPECIES.filter((species) => species[1].startsWith('Z')).map((species) => species[1]),
    ['ZUBAT', 'ZAPDOS', 'ZIGZAGOON', 'ZANGOOSE']);
});

test('each possible letter star can learn a damaging move', () => {
  const moves = readFileSync(new URL('../pokefirered/src/data/battle_moves.h', import.meta.url), 'utf8');
  const damaging = new Set([...moves.matchAll(/\[MOVE_(\w+)\]\s*=\s*\{([^}]*)\}/g)]
    .filter((match) => Number(match[2].match(/\.power\s*=\s*(\d+)/)?.[1] ?? 0) > 0)
    .map((match) => match[1]));
  for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const star = SPECIES.filter((species) => !species[3] && species[1].startsWith(letter))
      .reduce((best, species) => species[2] > best[2] ? species : best);
    assert.ok([...learnableMoves(star[0])].some((id) => damaging.has(MOVES.get(id))), star[1]);
  }
});

test('daily team has the strongest possible letter star, one legendary, and stable species', () => {
  const seed = dailySeed('2026-10-12');
  const word = 'yodel';
  const team = selectDailyTeam(word, seed);
  assert.deepEqual(team, selectDailyTeam(word, seed));
  const best = word.split('').map((letter) => Math.max(...SPECIES.filter((species) =>
    !species[3] && species[1].startsWith(letter.toUpperCase())).map((species) => species[2])));
  assert.equal(team.starSlot, best.indexOf(Math.max(...best)));
  assert.equal(team.species[team.starSlot].baseStats, Math.max(...best));
  assert.ok(team.species.slice(0, 5).every((species, index) => species.name.startsWith(word[index].toUpperCase())));
  assert.ok(team.species.slice(0, 5).every((species) => !species.legendary));
  assert.equal(team.species.filter((species) => species.legendary).length, 1);
  assert.equal(team.species[5].legendary, true);
  assert.ok(total(team) >= 2700);
});

test('repeated letters use distinct species first and repeat when necessary', () => {
  const seed = dailySeed('2026-10-12');
  const fizzy = selectDailyTeam('fizzy', seed);
  assert.equal(new Set(fizzy.species.slice(0, 5).map((species) => species.id)).size, 5);
  assert.ok(total(fizzy) >= 2700);
  const zzzzz = selectDailyTeam('zzzzz', seed);
  assert.ok(new Set(zzzzz.species.slice(0, 5).map((species) => species.id)).size < 5);
  assert.ok(total(zzzzz) >= 2700);
});
