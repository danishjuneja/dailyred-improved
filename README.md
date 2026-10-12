# Daily Red

A daily Pokémon battle in the browser, like Wordle: reveal the day's answer and
team, then press **Play**. Five level 100 Pokémon follow the answer's letters,
including one guaranteed strongest-match star, plus a legendary. Everyone
gets the same team that day and climbs to RED at the top of the
mountain. You get one battle per day. Your wins, losses, win streak and daily
play streak are kept in your browser.

Every battle runs on the original Pokémon FireRed engine: the game is the
[pret/pokefirered](https://github.com/pret/pokefirered) decompilation with a
small set of source changes, built into a GBA ROM and played in the browser
through the mGBA emulator compiled to WebAssembly. Nothing about battles is
reimplemented in JavaScript.

- [Quick start (Windows, Linux, macOS)](#quick-start-windows-linux-macos)
- [Build without Docker](#build-without-docker)
- [How it works](#how-it-works)
- [Team generation](#team-generation)
- [RED's team](#reds-team)
- [Development workflow](#development-workflow)
- [Testing and debugging](#testing-and-debugging)
- [Running it locally](#running-it-locally)
- [Copyright and licenses](#copyright-and-licenses)
- [Known limitations](#known-limitations)

## Quick start (Windows, Linux, macOS)

Install Docker Desktop or Docker Engine, then run one command from the
repository root. The script builds the game from the pinned FireRed source,
downloads the pinned emulator assets, and starts the site; no Xcode tools or
separate ROM are needed. Later launches reuse Docker's build cache.

```text
scripts\play.cmd          # Windows Command Prompt or PowerShell
```

```sh
bash scripts/play.sh     # macOS or Linux terminal
```

Open <http://localhost:8080>, answer the Wordle prompt, review the team, and
press Play. If port 8080 is in use, pass a
different port: `scripts\play.cmd 3000` or `bash scripts/play.sh 3000`.
Press Ctrl+C in the terminal to stop the server (on Windows, confirm the batch
prompt with `Y`). These scripts require Docker to be installed and running;
they do not change system software. This works on Windows, Linux and macOS with
Docker's Linux containers enabled. A device visiting a hosted copy needs only a
modern browser, not Docker. The browser stores each player's stats on that
device.

If something needed to start the game is missing, the launcher stops and names
it: an incomplete checkout, Docker, the Docker engine, or Linux-container mode.
Build failures point to a detailed-log command; port conflicts suggest another
port.

To host it for others, run `docker build -t dailyred .` and publish the image's
port 8080 through an HTTPS reverse proxy. The image listens on `0.0.0.0:8080`
inside the container and runs as an unprivileged user. The build needs internet
access. During daily play, the server also needs outbound access to the NYT
Wordle endpoint; game assets are served locally.

For Vercel hosting, see [the deployment guide](docs/deploy-vercel.md).

## Build without Docker

On macOS, you need the Xcode Command Line Tools (`xcode-select --install`), Node.js 18+
and git. No Homebrew, no `sudo`, and **no ROM**: the decompilation builds the
whole game from source.

```sh
scripts/setup-macos.sh      # ARM cross-compiler + libpng into .toolchain/ (~1 GB, one time)
scripts/get-pokefirered.sh  # pret/pokefirered at a pinned commit + patches/
scripts/fetch-vendor.sh     # emulator, emulator core and font into web/vendor/
scripts/build-rom.sh        # builds the ROM, writes web/game/dailyred.gba.gz
node scripts/serve.mjs      # open http://localhost:8080
```

`setup-macos.sh` picks the right compiler for Intel or Apple Silicon Macs.

On Linux, install `build-essential`, `binutils-arm-none-eabi`,
`gcc-arm-none-eabi`, `libnewlib-arm-none-eabi`, `libpng-dev`, `pkg-config`,
`git`, `curl` and `unzip` (package names shown for Debian/Ubuntu). Then run
`scripts/get-pokefirered.sh`, `scripts/fetch-vendor.sh`,
`scripts/build-rom.sh`, and `node scripts/serve.mjs`. On Windows, the Docker
route above avoids a local Unix build environment.

## How it works

```
pret/pokefirered @ 037335f + patches/  ──make modern──▶  pokefirered_modern.gba
                                                              │ gzip (16 MB → 5.5 MB)
web/ (static files)                                           ▼
  index.html + app.js ── Wordle answer via scripts/serve.mjs
        │  chooses and reveals the team from species-data.js before Play
        │  fetches game/dailyred.gba.gz and vendor/mgba_libretro.wasm after Play
        │  writes seed + answer + revealed species + record into the ROM (rom-config.js)
        ▼
  Nostalgist.js ──▶ RetroArch + mGBA core (WebAssembly) ──▶ <canvas>
        ▲
        └─ game-link.js reads the battle's status from the game's RAM
           → daily.js updates your stats in localStorage
```

**Why an emulator instead of compiling the C to WebAssembly:** the decomp is
written for GBA hardware (video, DMA, interrupts, the m4a sound engine,
ARM/Thumb assembly). Running the real ROM in mGBA keeps the battle engine,
animations and sound exactly as shipped, with no porting work. mGBA has a
built-in BIOS replacement, so no BIOS file is needed either.

**Why Nostalgist + RetroArch's mGBA core:** it accepts the ROM as raw bytes
(needed for the config below), exposes button presses and the emulator's
memory to JavaScript, and doesn't need `SharedArrayBuffer` or special headers.
Emulator assets load from `web/vendor/`; the Node server proxies Wordle answers.

### The daily game

- **The day's team:** the site fetches the Wordle answer for today's date in
  the player's own time zone through `/api/wordle/YYYY-MM-DD`. The seed is a
  hash of that date (`dailySeed` in `web/daily.js`), so the five letter-based
  picks and the legendary are fixed for everyone on that calendar day. The
  answer and exact six species are revealed before the ROM is downloaded.
- **Site → game:** the ROM contains a small struct, `gDailyRedRomConfig`: the
  magic bytes `DAILYRED-CONF-V4`, then the seed, the player's wins and battles
  so far, a "daily" flag, the five answer letters, and six species IDs. Before booting,
  `web/rom-config.js` finds the
  magic bytes in the downloaded ROM and fills them in; no addresses are
  hard-coded on either side. The game uses the record for its "Record: x
  win(s) in x battle(s)" message.
- **Game → site:** the game keeps a status block in RAM (`sStatus` in
  `src/dailyred.c`): the magic `DAILYRED-STATUS1`, the seed, a phase (exploring
  / battle / result / finished) and a result (won / lost). `web/game-link.js`
  finds it in the emulator's WebAssembly memory (the magic followed by the
  seed it injected) and reads it twice a second.
- **One battle a day:** the day counts as played as soon as RED's battle
  starts; closing or reloading the page mid-battle counts as a loss. The
  result is saved the moment it's known. After the closing messages the game
  fades to black and holds; the site then closes it and shows today's result
  and a countdown to the next battle. Before the battle you can reload freely:
  it's the same team all day.
- **Stats** (`web/daily.js`, localStorage key `dailyred-stats`): wins, losses,
  win streak (daily wins in a row) and day streak (days played in a row).
  Missing a day resets both streaks.
- **Without the website** (seed 0, e.g. the ROM in a desktop emulator): the
  normal intro and title screen appear, pressing Start seeds the game the way
  vanilla FireRed does, and after each battle a new team arrives.
- **`?seed=1234`** in the URL starts a practice run for testing: that seed's
  team, no daily limit, nothing saved, and a new team after each battle. It
  isn't shown anywhere in the UI.

### Game flow and the files involved

| Step | Code |
|---|---|
| Copyright screen → straight in (seed set) | `src/intro.c` → `CB2_DailyRed_StartFromCopyright` (`src/dailyred.c`) |
| Title screen → straight in (no seed) | `src/title_screen.c` → `CB2_DailyRed_StartFromTitle` |
| New game data: LEAF (FireRed's female player), fast text | `StartNewGame` in `src/dailyred.c`, then vanilla `CB2_NewGame` |
| Team + warp to the summit instead of the bedroom | `src/new_game.c` → `DailyRed_InitNewGame` |
| The summit: an open peak with no exits; stairs up to RED, who faces the drop | `data/maps/DailyRed_Summit/`, `data/layouts/DailyRed_Summit/` |
| Snow on the summit (fixes FireRed's unused snow weather, whose flakes never came back) | `src/field_weather_effects.c` |
| Talking to RED → battle → "You defeated RED!" / "Your team was wiped out…" → record → "Play again tomorrow!" / "Try again tomorrow." → fade out | `data/maps/DailyRed_Summit/scripts.inc` and `text.inc`; the `DailyRed_On*` specials in `src/dailyred.c` |
| Mountain battle background on the summit | `BattleSetup_GetTerrainId` in `src/battle_setup.c` |
| No free switch when RED's Pokémon faints: Battle Style starts on SET and is locked in Options | `StartNewGame` in `src/dailyred.c`, `src/option_menu.c` |
| RED as a trainer | `TRAINER_DAILYRED_RED` in `include/constants/opponents.h`, `src/data/trainers.h`, `src/dailyred_boss.c` |
| Menus: POKéMON / OPTION / EXIT; party: SUMMARY / SWITCH / CANCEL | `src/start_menu.c`, `src/party_menu.c`; window height for short menus in `src/new_menu_helpers.c` |
| RED's overworld sprite, in its own palette slot so it doesn't clash with LEAF's | `OBJ_EVENT_GFX_DAILYRED_RED` in `include/constants/event_objects.h`, `src/data/object_events/` |

The battle itself is a standard FireRed trainer battle. The map script uses
`trainerbattle_earlyrival` with `RIVAL_BATTLE_HEAL_AFTER`, the mode FireRed
uses for the rival fight in Oak's lab, so losing doesn't white out. The script
then reads `VAR_RESULT`, updates a win/battle counter, calls the
`DailyRed_StartNextRun` special (new team) and warps back to the start tile,
which also resets RED.

Every vanilla file that was changed has a `Daily Red:` comment at the change:

```sh
grep -rn "Daily Red" pokefirered/src pokefirered/include pokefirered/data
```

The summit layout is a copy of Navel Rock's summit (the peak where Ho-Oh
appears) with the arrival ladder removed. RED stands on the tip at (9, 11)
facing north, out over the drop, and turns around when you talk to him. The project uses pokefirered's `modern` target (GCC 14),
not the byte-matching `agbcc` build, so it doesn't reproduce the retail ROM.

## Team generation

`pokefirered/src/dailyred_team.c` builds each team with the decomp's own data
(`gLevelUpLearnsets`, `CanMonLearnTMHM`, the TM/HM move table,
`CreateMon`, `CalculateMonStats`):

- **Daily species:** the first five slots follow the Wordle answer in order:
  `yodel` gives a Y, O, D, E and L Pokémon. The strongest possible non-legendary
  match across those letters is the guaranteed star; for `yodel`, that is
  Dragonite in the D slot (ties use the first letter). The other four are seeded random picks. After those
  five, a seeded random legendary or mythical Pokémon fills the sixth slot
  and brings the team to at least 2700 combined base stats. The selector
  retries the random picks if none qualify. It uses different species for repeated
  letters when possible, and permits repeats for those letters if needed to
  reach the minimum. If no matching combination can reach 2700, it uses the
  strongest available combination. The star gets at least one damaging move
  through the existing move generator. The word comes from the NYT endpoint
  before play; if that service is unavailable, the site asks the player to retry.
  `web/species-data.js` is generated from FireRed's species names and base
  stats by `node scripts/generate-species-data.mjs`. All A–Z letters have at
  least one non-legendary Gen 1–3 match, including Z (Zubat, Zigzagoon,
  Zangoose), so no letter currently requires a legendary star.
- **Practice/standalone species:** 6 different Pokémon from all 386 of Generations 1–3 whose
  **base stat totals add up to at least 2700** (`MIN_TEAM_BASE_STAT_TOTAL`).
  **Legendaries are a 1-in-8 roll** (`LEGENDARY_TEAM_ODDS`): 1 team in 8 gets
  exactly one legendary or mythical Pokémon, in a random party slot, and the
  other 7 get none. The generator then redraws the rest of the team until it
  meets the minimum, so every qualifying team is equally likely. Per-species
  rules live in `IsEligibleSpecies`, e.g. add "fully evolved only" there.

  Why a minimum: RED's team totals 2954 (see below). A fully random team
  averages about 2430, and two thirds of them include a Pokémon under 300,
  which made most runs hopeless. A team can still include one weak Pokémon if
  the rest make up for it.

  Why legendaries are a separate roll: they average 613 against 393 for
  everything else, so a stat minimum on its own mostly gets met by drawing
  one. With a 2750 minimum alone, 70% of teams had a legendary and 20% had two
  or more.

  How the minimum sets the difficulty: with the IVs and EVs below, a team's
  actual in-battle stat total is almost exactly 2 × its base stat total +
  2580, and RED's is 8555. So each minimum gives:

  | Minimum | Typical team vs RED | Weakest possible | Teams stronger than RED |
  |---|---|---|---|
  | 2600 | 94% | 91% | about 1 in 45 |
  | 2650 | 95% | 92% | about 1 in 34 |
  | **2700** | **96%** | **93%** | **about 1 in 25** |
  | 2750 | 97% | 94% | about 1 in 17 |

  (Odds from simulating 80,000 teams.) Measured in the real ROM at 2700 over
  80 runs: typical team 95% of RED's stats, range 93–101%, 1 team stronger
  than RED. RED also has hand-picked moves, chosen held items (his Pikachu's
  Light Ball doubles its Sp. Atk) and the strongest trainer AI, so he stays
  the favourite.

- **Moves:** up to four distinct moves, legal by level-up (any level) or
  TM/HM. The first two are dependable attacks where available: at least 50
  power and 90% accuracy (or never-miss), with fixed-damage exceptions such as
  Seismic Toss. Charging, recharge, self-KO and conditional attacks do not
  qualify for these slots. The second attack uses another type when possible.
  Choices favour power, the species' physical/special stats and same-type
  attack bonus; the daily seed chooses among candidates within 85% of the best
  score. Remaining slots combine coverage with a curated support pool, including
  recovery, status and setup matched to the chosen attacks. Limited-learnset
  species retain legal fallback moves.
- **Stats:** level 100, random personality (so random nature, gender, ability
  and the usual 1/8192 shiny chance), and trained close to RED's level:
  - **IVs** random from 25 to 31 in every stat (`MIN_TEAM_IV`); RED's are all 31.
  - **EVs** 252 into each of its two highest base stats and the last 6 into
    HP, or into its third-best stat if HP is one of the two
    (`AssignFocusedEVs`). Attack and Sp. Atk only count if one of its attacks
    uses them (in Gen 3 a move's type decides which), so a Gyarados with only
    Surf and Ice Beam doesn't waste points on Attack. Fast Pokémon end up as
    fast as RED's; slow walls put their points into bulk instead.

  The player is the original trainer, so everything obeys, and Pokémon are
  marked as event Pokémon so Mew and Deoxys obey too.
- **Held items:** Rest gets Chesto Berry. Compatible species get Light Ball,
  Thick Club, Soul Dew or Deep Sea Tooth when their attacks use the boosted stat.
  Otherwise items are scored against the finished moves and stats: Leftovers
  favours bulk and sustained play, Lum Berry favours setup, and type boosters
  favour the primary attack and offensive sets. Choice Band needs at least
  three physical attacks (two dependable), Attack at least as high as Sp. Atk,
  and no recovery or setup; the fourth move may be Toxic, Thunder Wave or
  Encore, used before switching out of the choice lock. The daily seed selects
  among items scoring at least 90% of the highest suitability score. These scores are
  design heuristics, not simulated win rates.
  There are still no bag items.
- **Safety:** each Pokémon is validated (level, HP, at least one move, no
  duplicate moves, PP). If a Pokémon somehow failed 10 times, the game would
  use FireRed's own default level-100 moveset for it rather than hand over
  something broken.

The move picker still excludes tutors and egg moves and is a curated rule-based
builder, not an imported competitive-set database. Specialist species with very
limited learnsets cannot always meet the two-attack rule. IVs, nature and abilities
retain their existing seeded variation.

**Daily determinism is a hard requirement:** for the same calendar date, answer
and game version, every player gets identical species, moves, held items, IVs,
EVs, nature and ability. Builds use only the dedicated team RNG, never browser
randomness, timing, player history or a live moveset service. A new algorithm
version can change that date's build, so deploy gameplay updates between daily
rounds when possible. Species selection and the 2700 BST rule are unchanged.


## RED's team

Edit **`pokefirered/src/dailyred_boss.c`**: species, level, IVs, held item and
moves use FireRed's normal `TrainerMonItemCustomMoves` format, plus an EV
table next to it. It's Red's Mt. Silver team from HeartGold/SoulSilver
(Pikachu, Espeon, Snorlax, Venusaur, Charizard, Blastoise) at level 100 with
perfect IVs, held items and full EV spreads. HGSS used several Gen 4 moves, so
the movesets are adapted to Gen 3 ones.

| Pokémon | HP | Atk | Def | Spe | SpA | SpD | Total |
|---|---|---|---|---|---|---|---|
| Pikachu (Light Ball doubles its Sp. Atk) | 35 | 55 | 30 | 90 | 50 | 40 | 300 |
| Espeon | 65 | 65 | 60 | 110 | 130 | 95 | 525 |
| Snorlax | 160 | 110 | 65 | 30 | 65 | 110 | 540 |
| Venusaur | 80 | 82 | 83 | 80 | 100 | 100 | 525 |
| Charizard | 78 | 84 | 78 | 100 | 109 | 85 | 534 |
| Blastoise | 79 | 83 | 100 | 78 | 85 | 105 | 530 |
| **Team** | | | | | | | **2954** |

These are Gen 3 base stats from `src/data/pokemon/species_info.h`. With your
team's IVs (25–31) and focused EVs, both sides get about the same out of their
base stats. Measured from game RAM, a 525-total Pokémon reaches about 1520
actual stat points for RED and about 1533 for you; his natures come from
FireRed's fixed formula and sometimes cut a stat he needs. (With fully random
IVs and EVs it was about 1445 for you, which made him much stronger point for
point.)

RED's name, trainer class ("PKMN TRAINER"), sprite and AI flags (the same as
FireRed's Champion) are in `[TRAINER_DAILYRED_RED]` in
`pokefirered/src/data/trainers.h`. He gets the Champion battle music
(`src/pokemon.c`). FireRed trainers have no EVs, so a 3-line hook in
`CreateNPCTrainerParty` (`src/battle_main.c`) applies the EV table. Natures
come from FireRed's usual name-based formula and aren't configurable.

## Development workflow

1. Edit files in `pokefirered/` (a git checkout of pret's repo).
2. `scripts/build-rom.sh` (incremental builds take a few seconds).
3. Reload the page. `scripts/serve.mjs` sends `Cache-Control: no-cache`.
4. When you're happy, run `scripts/save-patch.sh` and commit
   `patches/pokefirered-dailyred.patch`.

If species names, stats or the legendary list change, run
`node scripts/generate-species-data.mjs` and commit `web/species-data.js` too.
Both container builds check that this catalogue matches the pinned ROM source.

`pokefirered/`, `.toolchain/`, `web/vendor/` and `web/game/` are not tracked
(see `.gitignore`); a clean checkout recreates them with the scripts above.
`git -C pokefirered diff` shows all game changes against upstream.

To play the ROM outside the browser, open
`pokefirered/pokefirered_modern.gba` in mGBA or any GBA emulator. Without an
injected seed it boots to the title screen; press Start.

The website has no build step: plain HTML, CSS and ES modules in `web/`.

## Testing and debugging

The tests boot the real ROM in headless Chrome through the same emulator the
website uses, press buttons, and read game RAM out of emulator save states
(mGBA's state contains a raw copy of RAM).

```sh
cd tests
npm ci --ignore-scripts # playwright-core only; it drives installed Chrome or Edge
node server.mjs     # static server security and HTTP behavior
node team.mjs       # fixed star, letter choices and repeated-letter fallback
npm run smoke      # the game loop (~3 min)
npm run site       # the website on desktop and phone (~1 min)
npm run teams -- 1 2 3            # print + validate the teams for these seeds
npm run teams -- --random 40      # 40 random seeds
```

For a quick browser check of a running container, use
`node tests/browser.mjs http://127.0.0.1:8080` from the repository root.

`npm run smoke` checks that:
- each seed's team is valid: 6 different real Gen 1–3 species with a combined
  base stat total of at least 2700 and at most one legendary, level 100, full
  HP, IVs 25–31, EVs exactly as `AssignFocusedEVs` would place them (checked
  by an independent JavaScript copy of the rule), an item from the pool (type boosters only with a
  matching attack), and every move learnable by the species. The
  learnable-move check parses the decomp's data files in JavaScript, so it's
  independent of the C generator.
- the same seed gives the same team, and different seeds give different ones.
- the player starts at the foot of the stairs, RED faces away from them (and
  again after every run), and talking to RED starts a trainer battle on the
  mountain background.
- battle style is SET from the start, the Options menu can't change it, and
  when one of RED's Pokémon is knocked out he sends the next one with no
  "Will LEAF change POKéMON?" prompt.
- RED's in-battle party is the configured team with IVs, items and EVs.
- a win and a loss are each handled: no white-out, counters updated, and a new
  valid team afterwards.
- the daily game starts from the website's record, reports the battle start,
  the result and the end, counts the battle in its record message, and
  ignores input once it's over (no second battle).
- without a seed, the title screen appears and Start leads into the game.

The win and loss are forced by editing HP values in a save state, which makes
them quick and deterministic. Screenshots of every step are saved in
`tests/output/`.

`npm run site` plays the daily game over five faked days (Playwright's clock):
a fresh visitor, a win (stats, locked until tomorrow, countdown, survives a
reload), the same team in a second browser that day, a loss the next day,
leaving mid-battle (counts as a loss), a missed day (streaks reset), and a
practice run (`?seed=`, not recorded). It also checks the 3× (720×480)
screen, RED's sprite, the phone layout and touch d-pad, and the download-error
screen with "Try again".

**Checking by hand:** open `http://localhost:8080/?seed=42` for a practice run
(nothing saved, no daily limit). To reset your daily stats, run
`localStorage.removeItem('dailyred-stats')` in the browser console.

**In the browser console:** `dailyRed.emulator` is the running Nostalgist
instance and `dailyRed.stats` shows your saved stats.

## Running it locally

Daily Red can also be played on your own computer. After the quick start,
`web/` holds the game assets (about 9 MB), and `node scripts/serve.mjs` serves
it at http://localhost:8080:

```
web/index.html  app.js  daily.js  wordle.js  team.js  species-data.js  game-link.js  game-files.js  rom-config.js  style.css  favicon.svg  licenses.txt
web/vendor/     emulator (3.4 MB) + font
web/game/       dailyred.gba.gz (5.5 MB), built on your machine
```

To use another port, pass it: `node scripts/serve.mjs 3000`. The server binds
to `127.0.0.1` by default; set `HOST=0.0.0.0` when serving outside the machine.
Your stats are saved in the browser for that address, so keep using the same port to keep
your streaks. After rebuilding the ROM (`scripts/build-rom.sh`), reload the
page.

## Copyright and licenses

Daily Red is a free, unofficial fan project. It isn't affiliated with or
endorsed by Nintendo, Creatures Inc., GAME FREAK inc. or The Pokémon Company.
Pokémon and all related names, characters and game content are © Nintendo,
Creatures Inc. and GAME FREAK inc.

This repository contains Daily Red's own work: the changes in `patches/`, the
website and the tests. It doesn't include pret/pokefirered or a built ROM; the
scripts fetch the decompilation from pret's repository and build locally.

The emulator core is GPL-3.0 (RetroArch) and MPL-2.0 (mGBA). `web/licenses.txt`
lists all third-party components with links to their source, and the page
footer links to it.

## Known limitations

- **Movement:** running shoes and the bike are off on the summit; it's only
  a few steps to the top.
- **Stats live in the browser:** clearing site data resets them, they don't
  follow you to another device or browser, and anyone can edit their own
  localStorage. That's fine for a casual daily game; the server keeps no player records.
- **Time zones:** the day changes at local midnight, so players in different
  time zones get each team at different times (as with Wordle).
- **Soft reset** (A+B+Start+Select) is turned off in the daily game, so a
  losing battle can't be restarted. (If the game ever restarts mid-battle
  anyway, the site counts it as a loss.)
- **Audio** can't be checked by the headless tests. Browsers start audio
  suspended unless it begins during a click, so the game resumes it on the
  next key press or tap.
- **Tested environment:** macOS with Google Chrome (headless, desktop and
  phone emulation). The container build targets Linux containers on Windows,
  Linux and macOS. Vercel hosting, Safari, Firefox and real phones remain
  untested until checked on a live deployment and those devices.
- The L/R buttons still open FireRed's built-in help, which describes the
  normal game.

## Project layout

```
patches/pokefirered-dailyred.patch   all changes to pret/pokefirered
scripts/setup-macos.sh               toolchain (xPack arm-none-eabi-gcc 14.2.1 + libpng)
scripts/play.sh, scripts/play.cmd     one-command Docker build and local play
Dockerfile                           Linux build and portable server image
Dockerfile.vercel                    Vercel container build of the same game
scripts/get-pokefirered.sh           pinned upstream checkout + patch
scripts/save-patch.sh                pokefirered/ changes → patches/
scripts/build-rom.sh                 make modern → web/game/dailyred.gba.gz
scripts/fetch-vendor.sh              Nostalgist, mGBA core, font (pinned, checksummed)
scripts/serve.mjs                    local server and Wordle proxy
scripts/generate-species-data.mjs   regenerate the browser species catalogue
web/                                 the website
tests/                               headless browser tests and the teams tool
```

Inside `pokefirered/`, the Daily Red code is `include/dailyred.h`,
`include/constants/dailyred.h`, `src/dailyred.c` (game flow and seed),
`src/dailyred_team.c` (team generator), `src/dailyred_boss.c` (RED's team), and
`data/maps/DailyRed_Summit/` plus `data/layouts/DailyRed_Summit/` (the map).
