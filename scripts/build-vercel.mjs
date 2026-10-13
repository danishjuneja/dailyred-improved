// Package an already-built game using Vercel's Build Output API.
// Build the ROM/vendor files with Docker or the native scripts first.
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { securityHeaders } from './http-headers.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const OUTPUT = join(ROOT, '.vercel', 'output');
export const ASSETS = [
  'game/dailyred.gba.gz', 'game/red.png',
  'vendor/mgba_libretro.js', 'vendor/mgba_libretro.wasm',
  'vendor/nostalgist.js',
];
const LICENSES = ['vendor/nostalgist.LICENSE.txt'];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

export async function buildVercel() {
  const source = join(ROOT, 'web');
  // Check every required input before replacing the previous build.
  const inputs = new Map();
  for (const path of [...ASSETS, ...LICENSES]) {
    try {
      const bytes = await readFile(join(source, path));
      if (!bytes.length) throw new Error('File is empty');
      inputs.set(path, bytes);
    } catch (cause) {
      throw new Error(`Missing or empty web/${path}. Run scripts/fetch-vendor.sh and scripts/build-rom.sh, or build with Docker first.`, { cause });
    }
  }

  await mkdir(join(ROOT, '.vercel'), { recursive: true });
  // Never follow an output/parent symlink outside this checkout when cleaning.
  const parent = await realpath(join(ROOT, '.vercel'));
  if (parent !== join(await realpath(ROOT), '.vercel')) throw new Error('Refusing a linked .vercel directory');
  const existing = await realpath(OUTPUT).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return OUTPUT;
  });
  if (existing !== join(parent, 'output')) throw new Error('Refusing a linked output directory');
  await rm(OUTPUT, { recursive: true, force: true });
  const staticDir = join(OUTPUT, 'static');
  const functionDir = join(OUTPUT, 'functions/api/wordle.func');
  await mkdir(staticDir, { recursive: true });
  await mkdir(functionDir, { recursive: true });

  const assets = {};
  const hashes = {};
  for (const path of ASSETS) {
    const compress = path.endsWith('.wasm');
    const bytes = compress ? gzipSync(inputs.get(path), { level: 9 }) : inputs.get(path);
    const hash = sha256(bytes);
    const nameHash = process.env.VERCEL_HASH_SALT
      ? sha256(Buffer.concat([Buffer.from(process.env.VERCEL_HASH_SALT), bytes])) : hash;
    const url = `/_vercel/immutable/${nameHash}/${basename(path)}${compress ? '.gz' : ''}`;
    assets[path] = url;
    hashes[url] = hash;
    const dest = join(staticDir, url);
    await mkdir(resolve(dest, '..'), { recursive: true });
    await writeFile(dest, bytes);
  }
  for (const path of LICENSES) {
    await mkdir(join(staticDir, 'vendor'), { recursive: true });
    await writeFile(join(staticDir, path), inputs.get(path));
  }
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.(html|js|css|svg|txt)$/.test(entry.name)) continue;
    let contents = await readFile(join(source, entry.name), 'utf8');
    for (const [path, url] of Object.entries(assets)) {
      // Replace the optional ./ first so ES module imports stay absolute.
      contents = contents.replaceAll(`./${path}`, url).replaceAll(path, url);
    }
    await writeFile(join(staticDir, entry.name), contents);
  }
  for (const file of ['wordle-api.mjs', 'http-headers.mjs']) {
    await copyFile(join(ROOT, 'scripts', file), join(functionDir, file));
  }
  await writeFile(join(functionDir, '.vc-config.json'), json({
    runtime: 'nodejs24.x', handler: 'wordle-api.mjs', launcherType: 'Nodejs', maxDuration: 15,
  }));
  await writeFile(join(OUTPUT, 'immutable.json'), json({ version: 1, hashes }));
  await writeFile(join(OUTPUT, 'config.json'), json({
    version: 3,
    routes: [
      { src: '/(.*)', headers: securityHeaders, continue: true },
      { src: '/api/wordle/(.*)', dest: '/api/wordle' },
      ...Object.values(assets).map((url) => ({
        src: url.replaceAll('.', '\\.'),
        headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
        continue: true,
      })),
      { src: '/(?!_vercel/|api/)(.*)', headers: { 'Cache-Control': 'public, max-age=0, must-revalidate' }, continue: true },
      { src: '/', dest: '/index.html' },
      { handle: 'filesystem' },
    ],
    overrides: {
      [assets['vendor/mgba_libretro.wasm'].slice(1)]: { contentType: 'application/gzip' },
      [assets['game/dailyred.gba.gz'].slice(1)]: { contentType: 'application/gzip' },
    },
  }));
  return assets;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildVercel();
  console.log(`Vercel static assets and Wordle function ready in ${OUTPUT}`);
}
