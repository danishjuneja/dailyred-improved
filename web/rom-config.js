// Writes the run settings into the Daily Red ROM image before it is booted.
//
// The game keeps a small struct in ROM (gDailyRedRomConfig in
// pokefirered/src/dailyred.c): the 16-byte magic "DAILYRED-CONF-V4", then
// little-endian u32 seed, u16 wins, u16 battles, u8 daily and five ASCII word
// letters, then six u16 species IDs. Finding it by its
// magic means no addresses are hard-coded here. A non-zero seed makes the game
// skip the title screen and generate its team from that seed.

const MAGIC = new TextEncoder().encode('DAILYRED-CONF-V4');

export function findConfigOffset(rom) {
  const first = MAGIC[0];
  outer: for (let i = rom.indexOf(first); i !== -1; i = rom.indexOf(first, i + 1)) {
    for (let j = 1; j < MAGIC.length; j++) {
      if (rom[i + j] !== MAGIC[j]) continue outer;
    }
    return i + MAGIC.length;
  }
  return -1;
}

// Returns a patched copy of `rom` (a Uint8Array); the original is untouched.
//   seed     non-zero team seed
//   wins     the player's record before this game (shown in the game's
//   battles  record message)
//   daily    true for the daily game: one battle, then the game ends
//   word     the five-letter Wordle answer for daily play
//   species  the six species shown in the daily reveal
export function injectConfig(rom, { seed, wins = 0, battles = 0, daily = false, word = null, species = null }) {
  const offset = findConfigOffset(rom);
  if (offset < 0) throw new Error('This ROM has no Daily Red config. Rebuild it with scripts/build-rom.sh.');
  if (daily && !/^[a-z]{5}$/.test(word)) throw new Error('A five-letter Wordle answer is required for daily play.');
  if (species && (species.length !== 6 || species.some((id) => !Number.isInteger(id) || id < 1 || id > 411))) {
    throw new Error('A team must contain six valid species IDs.');
  }
  const patched = rom.slice();
  const view = new DataView(patched.buffer);
  view.setUint32(offset, seed >>> 0, true);
  view.setUint16(offset + 4, Math.min(wins, 0xFFFF), true);
  view.setUint16(offset + 6, Math.min(battles, 0xFFFF), true);
  view.setUint8(offset + 8, daily ? 1 : 0);
  for (let i = 0; i < 5; i++) view.setUint8(offset + 9 + i, daily ? word.charCodeAt(i) : 0);
  for (let i = 0; i < 6; i++) view.setUint16(offset + 16 + i * 2, daily && species ? species[i] : 0, true);
  return patched;
}

// Parses a seed typed by a person, e.g. from ?seed=1234. Returns null if invalid.
export function parseSeed(text) {
  if (text == null || !/^\d{1,10}$/.test(String(text).trim())) return null;
  const seed = Number(text);
  return seed >= 1 && seed <= 0xFFFFFFFF ? seed : null;
}
