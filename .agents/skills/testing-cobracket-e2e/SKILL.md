---
name: testing-cobracket-e2e
description: How to run cobracket end-to-end tests locally — anonymous Convex backend, auth keys, dev server, and the golden Organizer path (create → roster → generate → publish → share link).
---

# Testing cobracket end-to-end locally

Use this when asked to E2E-test the cobracket Solid 2 app in a real browser against a real backend (not the unit/e2e vitest gates).

## Devin Secrets Needed

None — Convex Auth anonymous sign-in requires no credentials. Do not use production env vars; the app must point at a **local** deployment.

## Bring up the backend (anonymous local deployment)

```bash
cd /home/ubuntu/repos/cobracket
CONVEX_AGENT_MODE=anonymous bun run convex:dev   # tty; leave running
```

- bun is `~/.bun-pinned/bun` on PATH.
- First run may fail the push with `MissingEnvironmentVariables: AUTH_JWKS, AUTH_PRIVATE_KEY`. Fix while that process is still up (the backend stays on :3210):
  ```bash
  CONVEX_AGENT_MODE=anonymous CONVEX_DEPLOYMENT=anonymous:anonymous-agent bun run auth:keys
  ```
  then **kill and restart** `convex dev` — Convex 1.46 does not re-push after the second env var is set (see AGENTS.md / e2e/global-setup.ts). Success prints `Convex functions ready`.
- The CLI writes `.env.local` with `CONVEX_DEPLOYMENT=anonymous:anonymous-agent`, `VITE_CONVEX_URL=http://127.0.0.1:3210`.
- The auth CLI prints file templates for `convex/auth.ts`/`auth.config.ts` — **ignore them**; never overwrite those files.
- Beware: `convex dev` spawns a backend grandchild that survives killing only the CLI — kill the process group when cleaning up.

## Bring up the frontend

```bash
VITE_CONVEX_URL=http://127.0.0.1:3210 bun dev --port 3000
```

- vite-plus `vp dev` serves on :3000 with `host: '0.0.0.0'`.
- `curl -H 'Accept: text/html' localhost:3000/` must return 200 before driving a browser (a plain fetch without the header may 404).

## Golden path through the UI

1. `/` — header `🐍 cobracket`, locale toggle (`日本語` ⇄ `English`, aria-label `Language`/`言語`), theme toggle (`Theme: Auto` → Light → Dark → Auto; sets `documentElement.style.colorScheme` to `"light dark"`/`light`/`dark`). Persists `cobracket:locale` ∈ {en,ja} and `cobracket:theme` ∈ {system,light,dark}.
2. Create form: name input, DisciplineInput (plain `<input>` + datalist), Format fieldset radios, `Create tournament` → anonymous `ensureOrganizer()` sign-in → `createTournament` → router navigates to `/t/:id`.
3. `/t/:id` — roster: bulk textarea (`Paste a list of names — one per line`) + `Add all`; bracket: `Generate Bracket` (needs ≥2 participants), `Publish` (only while draft with a bracket). Match cards are clickable only when status ≠ draft — publish **before** testing the `Record result` Portal dialog.
4. `/s/:slug` — readonly: TournamentHeader + TournamentBoard only (all cards `disabled`, no roster/generate controls). Same header toggles — locale switches here too.
5. `*404` — `Page not found.` + `Back to home` (separate surface worth one visit).

## Verifying console cleanliness

- In-page `window.__errLog` collectors do **not** survive navigations/reloads. Prefer opening DevTools console (Ctrl+Shift+J) — it covers everything since last load; the Solid router navigates client-side so one buffer covers a whole flow. Enable `Verbose` to see all messages; `[vite] connecting/connected` and Convex `WebSocket reconnected` are benign.
- DevTools `Issues` count includes autofill/a11y hints (e.g. "form field should have an id or name") — these are warnings, not errors, and reset per page load.
- The dev server also serves `POST /__solid/diagnostics` (`begin`/`costs`/`end`) for Solid diagnostic codes — see AGENTS.md.
