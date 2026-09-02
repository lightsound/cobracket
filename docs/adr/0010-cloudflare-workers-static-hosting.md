# Host the web UI on Cloudflare Workers static assets, built in CI

The web UI ships as a Worker that serves static assets and nothing else: `wrangler.jsonc` points `assets.directory` at `dist/client` and sets `assets.not_found_handling` to `single-page-application`, with no `main` entry. GitHub Actions produces `dist/client` and uploads it; Cloudflare never builds the project.

Two properties decided this. First, the SPA requirement is absolute: `/t/:tournamentId` and `/s/:shareSlug` exist only in Solid Router, so unmatched paths must return `/index.html` with `200 OK` or a Share Link breaks on the first direct visit — exactly the thing this milestone exists to make work. `not_found_handling: "single-page-application"` is that behavior as one declarative line, and it is the whole of the hosting configuration. Second, requests that a Worker serves from static assets are free and unmetered, which is the right shape for the spectator asymmetry the vision names (a popular Share Link can have orders of magnitude more viewers than participants).

The choice also keeps the next step cheap. Per-Share-Link OGP tags are the planned work after this one, and a client-rendered SPA cannot produce them. On Workers that is additive: add a `main` entry plus `assets.run_worker_first: ["/s/*"]`, rewrite the shell's `<head>` for that one path, and every other route keeps being served straight from the asset CDN. No re-platforming, no second provider, no framework change.

Building in GitHub Actions rather than in the provider's build image follows from ADR 0004. The toolchain is deliberately pre-release — Bun 1.4, Vite+, Solid 2 RC, Convex Auth v2 alpha — and a hosted build image pins its own Bun and Node versions on its own schedule. CI pins Bun explicitly, runs the repository's gates before anything reaches production, and reduces the provider's role to accepting a directory. That also means `convex deploy --cmd 'bun run build'` (which injects the production `VITE_CONVEX_URL` into the build) runs in the same place as the gates, so the backend push and the frontend bundle always describe the same revision.

Lock-in is small and deliberately bounded: `wrangler.jsonc`, one `wrangler` devDependency, and the last two steps of one workflow file. Nothing in `src/` or `convex/` knows where the bundle is served from.

## Considered Options

**Netlify or Vercel with a provider-run build**, the path Convex documents. Rejected for the build half: it hands the pre-release toolchain to a build image we do not control, and it moves the gates out of the deploy path. Both remain fine as pure static hosts, and switching to either is a one-file change — Netlify's `_redirects` covers the same SPA rewrite. Vercel additionally has the clumsiest prebuilt-upload story of the three (`.vercel/output` via the Build Output API), which is why it is not the fallback.

**Cloudflare Pages.** Same CDN, same `_redirects` support, and a simpler git-push story, but Cloudflare has moved its investment to Workers static assets and treats Pages as maintenance-only; features (including the Worker-in-front routing that per-Share-Link OGP needs) land on Workers first. Starting on the product that is being deprecated in practice buys nothing here, because we are not using the git integration anyway.

**GitHub Pages**, which needs no third-party account at all. Rejected on the requirement that decided the ADR: it has no catch-all rewrite. SPA deep links can only be faked through `404.html`, which serves the app with a `404` status — bad for the Share Links this milestone is about, and actively harmful once OGP crawlers matter. It would also force a `base` path on the router and the build.

## Consequences

- Production needs three secrets: `CONVEX_DEPLOY_KEY` (Convex production deploy key, with the env-write permission so `bun run auth:keys` can seed `AUTH_PRIVATE_KEY`/`AUTH_JWKS`), `CLOUDFLARE_API_TOKEN`, and `CLOUDFLARE_ACCOUNT_ID`. The runbook lives in AGENTS.md.
- Backend and frontend are deployed by two commands in one job. If the asset upload fails after the function push succeeds, production runs new functions with the previous bundle; re-running the workflow is the fix.
- The deployment has no server-side rendering, so anything needing per-URL HTML (OGP, crawlers) is a future Worker script, not a hosting migration.
