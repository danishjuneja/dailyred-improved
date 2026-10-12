import { SPECIES } from './species-data.js';

const MIN_TOTAL = 2700;
const MAX_ATTEMPTS = 1000;
const legendary = SPECIES.filter((species) => species[3]);
const byLetter = new Map('abcdefghijklmnopqrstuvwxyz'.split('').map((letter) => [
  letter,
  SPECIES.filter((species) => !species[3] && species[1][0].toLowerCase() === letter),
]));

function random(seed) {
  let state = seed >>> 0;
  return (limit) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % limit;
  };
}

// One species in the strongest possible five, with the star fixed in its slot.
function strongest(word, starSlot, star, allowRepeats) {
  const chosen = Array(5);
  chosen[starSlot] = star;
  const taken = new Set([star[0]]);
  for (let slot = 0; slot < 5; slot++) {
    if (slot === starSlot) continue;
    const pool = byLetter.get(word[slot]).filter((species) => allowRepeats || !taken.has(species[0]));
    if (!pool.length) return null;
    chosen[slot] = pool.reduce((best, species) => species[2] > best[2] ? species : best);
    taken.add(chosen[slot][0]);
  }
  return chosen;
}

const total = (species) => species.reduce((sum, entry) => sum + entry[2], 0);

export function selectDailyTeam(word, seed) {
  if (!/^[a-z]{5}$/.test(word)) throw new Error('Invalid Wordle answer.');
  const pick = random(seed);
  let starSlot = 0;
  let star = null;
  for (let slot = 0; slot < 5; slot++) {
    const pool = byLetter.get(word[slot]);
    if (!pool.length) throw new Error(`No non-legendary Pokémon starts with ${word[slot].toUpperCase()}.`);
    const best = pool.reduce((winner, species) => species[2] > winner[2] ? species : winner);
    if (!star || best[2] > star[2]) {
      star = best;
      starSlot = slot;
    }
  }

  const bestLegendary = legendary.reduce((best, species) => species[2] > best[2] ? species : best);
  let allowRepeats = false;
  let maximum = strongest(word, starSlot, star, false);
  if (!maximum || total(maximum) + bestLegendary[2] < MIN_TOTAL) {
    allowRepeats = true;
    maximum = strongest(word, starSlot, star, true);
  }
  if (!maximum) throw new Error('No Pokémon team matches this word.');

  let chosen = null;
  let finalLegendary = null;
  if (total(maximum) + bestLegendary[2] >= MIN_TOTAL) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const five = Array(5);
      five[starSlot] = star;
      const taken = new Set([star[0]]);
      for (let slot = 0; slot < 5; slot++) {
        if (slot === starSlot) continue;
        const pool = byLetter.get(word[slot]).filter((species) => allowRepeats || !taken.has(species[0]));
        five[slot] = pool[pick(pool.length)];
        taken.add(five[slot][0]);
      }
      const eligible = legendary.filter((species) => total(five) + species[2] >= MIN_TOTAL);
      if (eligible.length) {
        chosen = five;
        finalLegendary = eligible[pick(eligible.length)];
        break;
      }
    }
  }
  chosen ??= maximum;
  if (!finalLegendary) {
    const eligible = legendary.filter((species) => total(chosen) + species[2] >= MIN_TOTAL);
    finalLegendary = eligible.length ? eligible[pick(eligible.length)] : bestLegendary;
  }

  return {
    starSlot,
    species: [...chosen, finalLegendary].map(([id, name, baseStats, isLegendary]) => ({ id, name, baseStats, legendary: Boolean(isLegendary) })),
  };
}
