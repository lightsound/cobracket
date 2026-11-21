---
name: testing-cobracket-e2e
description: How to run cobracket end-to-end tests locally — the SpacetimeDB standalone boot (zero-setup via the e2e gate, or the manual dev flow), and the golden Organizer path (create → roster → generate → publish → share link).
---

# Testing cobracket end-to-end locally

Use this when asked to E2E-test the cobracket Solid 2 app in a real browser against a real backend (not the unit/e2e vitest gates).

## Prerequisites

None — no credentials and no auth keys: SpacetimeDB mints identities natively, so there is nothing to provision. Do not use production env vars; the app must point at a **local** SpacetimeDB standalone, never Maincloud. The gate enforces the same discipline itself: it asserts its target is local before the app starts, so it cannot publish to Maincloud or write tournaments to a cloud deployment.

## Run the gate (zero-setup path)

```bash
bun run test:e2e
```

`e2e/global-setup.ts` boots what the scenario needs, in three modes:

- `E2E_BASE_URL` set — it boots nothing and drives the page that URL points at (which must be served in `--mode e2e`).
- A local standalone already answering per `.env.local` (`VITE_SPACETIMEDB_HOST` / `VITE_SPACETIMEDB_DB` naming a local host) — it publishes the current module to that standalone, seeds the module secret, and starts only the dev server.
- Otherwise — it boots its own standalone on the gate's port (3125, override with `E2E_SPACETIME_PORT`) with a fresh data dir, publishes the module to the gate-only database `cobracket-e2e`, seeds the module secret, and starts the dev server.

Notes:

- The gate downloads the pinned SpacetimeDB binaries and the headless Chromium it needs when they are missing — no setup step.
- Children die with the run: teardown kills the whole process group and waits until every member is gone, because a server outlives a teardown that only waits for the leader. If a run is killed hard and leaves a standalone behind on the gate's port, the next run fails with `port 3125 is already in use` — stop that server or set `E2E_SPACETIME_PORT`.
- Nothing in the gate writes `.env.local`; the dev server receives its backend configuration (`VITE_SPACETIMEDB_HOST` / `VITE_SPACETIMEDB_DB`) in its environment.

## Bring up the stack by hand (manual dev flow)

Follow AGENTS.md's dev flow — two long-running processes: the standalone and the dev server.

Write `.env.local` (gitignored) before Vite boots, or every page shows the setup notice until Vite is restarted:

```bash
VITE_SPACETIMEDB_HOST=http://127.0.0.1:3100
VITE_SPACETIMEDB_DB=cobracket
```

Then:

```bash
spacetime start --listen-addr 127.0.0.1:3100   # local standalone; leave running (port 3100 — 3000 is the dev server's)
bun run spacetime:publish:local    # once; publishes the module and seeds the module secret
bun dev                            # frontend; leave running
```

- `bun run spacetime:publish:local` also seeds the module secret from the gitignored `.spacetime-secret` (created on first use, ADR 0032) — tournament creation needs it, and a re-run against the same database is a no-op success.
- vite-plus `vp dev` serves on :3000 with `host: '0.0.0.0'`.
- `curl -H 'Accept: text/html' localhost:3000/` must return 200 before driving a browser (a plain fetch without the header may 404).
- The local standalone's data persists across restarts, so restarts reuse the same database. Stop both processes when cleaning up.

## Golden path through the UI

1. `/` — header `🐍 cobracket`, locale toggle (`日本語` ⇄ `English`, aria-label `Language`/`言語`), theme toggle (`Theme: Auto` → Light → Dark → Auto; sets `documentElement.style.colorScheme` to `"light dark"`/`light`/`dark`). Persists `cobracket:locale` ∈ {en,ja} and `cobracket:theme` ∈ {system,light,dark}.
2. Create form: name input, DisciplineField (a label around a plain `<input>` + datalist), Format fieldset radios, `Create tournament` → anonymous `ensureOrganizer()` sign-in → `createTournament` → router navigates to `/t/:id`.
3. `/t/:id` — roster: bulk textarea (`Paste a list of names — one per line`) + `Add all`; bracket: `Generate Bracket` (needs ≥2 participants), `Publish` (only while draft with a bracket). Match cards are clickable only when status ≠ draft — publish **before** testing the `Record result` Portal dialog.
4. `/s/:slug` — readonly: TournamentHeader + TournamentBoard only (all cards `disabled`, no roster/generate controls). Same header toggles — locale switches here too.
5. `*404` — `Page not found.` + `Back to home` (separate surface worth one visit).

## Verifying console cleanliness

- In-page `window.__errLog` collectors do **not** survive navigations/reloads. Prefer opening DevTools console (Ctrl+Shift+J) — it covers everything since last load; the Solid router navigates client-side so one buffer covers a whole flow. Enable `Verbose` to see all messages; `[vite] connecting/connected` messages are benign.
- DevTools `Issues` count includes autofill/a11y hints (e.g. "form field should have an id or name") — these are warnings, not errors, and reset per page load.
- The dev server also serves `POST /__solid/diagnostics` (`begin`/`costs`/`end`) for Solid diagnostic codes — see AGENTS.md.
