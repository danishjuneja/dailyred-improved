# Deploy Daily Red to Vercel

The repository excludes `pokefirered/`, `web/vendor/` and `web/game/` because
they are generated. Serving `web/` directly would load the page but leave the
game unplayable. Vercel detects the root-level `Dockerfile.vercel` and builds
the ROM and emulator assets from the pinned sources during deployment. No
separate ROM upload or Vercel environment variables are needed.

1. Push the complete source to
   [danishjuneja/dailyred-improved](https://github.com/danishjuneja/dailyred-improved).
2. In Vercel, choose **Add New > Project**, import that repository, and leave
   **Root Directory** at the repository root. Select **Container** if Vercel
   asks for a preset, keep the detected `Dockerfile.vercel`, and deploy.
3. Open the deployment URL, answer the Wordle prompt, check the revealed team,
   then press **Play**. The first deployment compiles
   the game, so allow time for its build to finish. Loading the homepage alone
   will not verify that the roughly 5.5 MB ROM was served completely or that
   the server can fetch today's answer from NYT.

Enable **Web Analytics** in the Vercel project's **Analytics** tab before
deploying. The site includes Vercel's [plain-HTML integration](https://vercel.com/docs/analytics/quickstart)
for visitor and page-view counts; it does not need React or an npm package.
After deployment, visit the site and check that `/_vercel/insights/script.js`
loads and page views appear in the Analytics dashboard. Initialization uses
an external script compatible with the existing Content Security Policy.
Analytics is skipped on localhost; its endpoint is provided by Vercel, not
the standalone Docker server.

For a repeatable live game check on a machine with Chrome or Edge:

```sh
cd tests
npm ci --ignore-scripts
node browser.mjs https://YOUR-DEPLOYMENT-URL
```

If the build fails, check Vercel's build log for the failed download, checksum,
or compile step. The image runs as a Vercel container function with function
pricing; the server streams the ROM response. Each push to the connected branch
triggers a new deployment. Browser stats stay on each device and site address.
Daily play requires the container to reach `www.nytimes.com` at runtime through
`/api/wordle/YYYY-MM-DD`. If that request fails, the page asks the player to
retry; practice mode (`?seed=42`) remains playable without it.
A public deployment serves the built ROM to visitors, so review distribution
rights before sharing it widely.

See Vercel's [container deployment guide](https://vercel.com/kb/guide/does-vercel-support-docker-deployments)
and [function payload guide](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions).
