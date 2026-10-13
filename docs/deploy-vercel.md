# Deploy Daily Red to Vercel

Daily Red deploys as static files plus one small Node.js function for
`/api/wordle/YYYY-MM-DD`. The ROM and emulator downloads go directly through
Vercel's CDN, without invoking a function. The game still runs in the browser.

The GitHub Actions workflow builds the ROM with the existing Docker toolchain,
checks the static output and boots the game in Chrome before deploying. Vercel
receives prebuilt output; it does not compile or run a container for this site.

## One-time setup for the existing Vercel project

1. Keep the existing project and domain so browser statistics and streaks stay
   available. In **Settings > Build and Deployment**, change the framework
   preset from **Container** to **Other**, use Node.js **24.x**, and clear old
   container-specific overrides. The repository root remains the root directory.
2. In the GitHub repository's **Settings > Secrets and variables > Actions**,
   add these repository secrets:
   - `VERCEL_TOKEN`: an expiring Vercel access token scoped to the team owning
     this project. It can grant broader access within that team, so treat it as
     a password and revoke it if exposed.
   - `VERCEL_ORG_ID`: the team's ID (or the account ID for a personal project).
   - `VERCEL_PROJECT_ID`: the existing project's ID.
   The IDs can be obtained by running `vercel link` locally and reading the
   ignored `.vercel/project.json`. Never commit that file or the token.
3. Keep **Web Analytics** enabled in Vercel. The existing plain-HTML integration
   continues to use `/_vercel/insights/script.js`; no React package is needed.
4. Run **Actions > Vercel static deployment > Run workflow**, leaving
   **production** unchecked for a preview. Test the preview as described below.
   Then run it from `main` with **production** checked to deploy to the existing
   domain. Subsequent pushes to `main` build, test and deploy automatically.

`vercel.json` disables Vercel's own Git-triggered builds so GitHub Actions is the
single deployment path. Set up the secrets before relying on a new push to
publish an update. Missing secrets fail with an explicit message; the existing
live deployment stays available. Pull requests run the build and delivery tests
without deployment credentials. Manual production deployments require `main`.
Protect `main` and review workflow edits: anyone able to change a trusted
deployment workflow can potentially use its credentials. The token is supplied
only to the configuration check and deployment steps; build/test jobs receive
no deployment secrets. Actions are pinned to immutable commit IDs. GitHub
environment protection rules can require approval for `production` if desired.

## Build locally

With Docker running, from the repository root:

```sh
docker build --target vercel-export --output type=local,dest=.vercel .
```

This writes `.vercel/output`, including the static assets and the Wordle
function. Use a fresh output directory when exporting with Docker again; Docker's
local exporter overlays existing files. Only `.vercel/output` is generated;
keep `.vercel/project.json` if you have linked the project.

If you have already generated `web/game/` and `web/vendor/` using the native
build scripts, package them directly (this replaces the old output safely):

```sh
node scripts/build-vercel.mjs
```

A missing or empty ROM, emulator, sprite or required license makes packaging
fail with instructions. Local development still uses `node scripts/serve.mjs`.
The default `docker build -t dailyred .` still builds the standalone Node server.

For a manual deployment, install the workflow's pinned CLI (`vercel@63.1.2`),
link the existing project, and run:

```sh
vercel pull --yes --environment=preview
vercel deploy --prebuilt
```

For production, pull the `production` environment and add `--prod` to deploy.
The three GitHub secrets are only needed for automated deployments; the local CLI
can use your interactive login.

## Cache and download behavior

- ROM, WASM, emulator scripts and sprite use content-addressed URLs under
  `/_vercel/immutable/`, with `Cache-Control: public, max-age=31536000, immutable`.
  Identical files retain their URL across releases. Vercel's immutable manifest
  also makes prior asset URLs available when someone leaves an older page open.
- The WASM is precompressed from approximately 3.17 MB to 1.10 MB. The existing
  compressed ROM is approximately 5.47 MB. Both are unpacked in the browser;
  the emulator still receives ordinary WASM bytes. No CDN compression setting
  is required for these savings. The loader also handles HTTP-decoded gzip.
- The interface uses readable system fonts with equal-width digits for stats
  and the countdown. No web font download is needed.
- HTML and the small application modules revalidate on navigation so updates
  reach players. The game binaries download only after Play. Browsers may evict
  their cache, and private browsing or a hard reload can require another download.
- A new daily team does not change the ROM. The daily seed and revealed species
  are injected locally, preserving the shared daily team, moves and items.
- Successful Wordle responses are cached for five minutes in browsers and one
  hour on the CDN, keyed by the date in the URL. Warm functions also coalesce
  upstream requests and retain answers for up to an hour. Date validation and
  the eight-second NYT timeout remain in place. Errors are not cached.
- The shared CSP and other security headers apply to the static site and API.
  Assets remain same-origin; there is no new third-party runtime dependency.

## Verification and monitoring

After building, on a machine with Chrome or Edge:

```sh
npm ci --ignore-scripts --prefix tests
node tests/server.mjs
node tests/wordle-api.mjs
npm run vercel --prefix tests
```

The delivery tests verify content hashes, cache rules, API validation, retries,
and two real game starts with only one ROM/WASM download. They test local output,
not Vercel's live CDN. The ordinary `npm test --prefix tests` remains the full game
regression suite and requires the local patched game sources and ROM symbols.

Before switching production, verify the deployed preview:

1. Reveal today's team and press Play. This checks that the Vercel function can
   reach NYT and that the emulator receives complete files. A homepage-only check
   does not verify the game. Practice mode (`?seed=42`) does not test NYT access.
2. In browser Network tools, leave **Disable cache** unchecked. Check the hashed
   ROM and WASM URLs and their one-year immutable cache headers. Return in the
   same browser and confirm they load from memory/disk cache. Check that a new
   date requests a different `/api/wordle/YYYY-MM-DD` URL.
3. Check `x-vercel-cache`/`Age` on repeated requests to the dated API, and confirm
   static asset requests do not appear as function invocations. Cache behaviour
   can differ on password-protected previews; check the production response too.
4. Verify `/_vercel/insights/script.js` loads and Analytics records a visit.
5. Monitor **Fast Origin Transfer**, **Fast Data Transfer**, function invocations,
   and total spending. Configure budget alerts/actions in Spend Management. Pro's
   base subscription is not a hard cap on all usage charges.

To roll back, promote the previous working deployment in Vercel. Keep the same
hostname. Rolling back hosting does not erase local browser statistics.

References: [Build Output API](https://vercel.com/docs/build-output-api/primitives),
[GitHub Actions deployments](https://vercel.com/kb/guide/how-can-i-use-github-actions-with-vercel),
[cache headers](https://vercel.com/docs/caching/cache-control-headers),
[CDN usage](https://vercel.com/docs/manage-cdn-usage).
