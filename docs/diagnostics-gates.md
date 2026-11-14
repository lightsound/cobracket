# Diagnostics gates

The operative contracts for the two diagnostics gates live in `AGENTS.md`
(`## Architecture Notes` and `## Commands`). Implementation mechanics live in
the headers of the source files named below. This document holds what neither
of those places owns cleanly: how the gates fit together, why their
environments differ, the measurements the settings rest on, and the manual
procedure for re-proving the browser gate.

Read this before changing `src/test-setup.ts`, `src/diagnostics-verdict.ts`,
`src/diagnostics-gate.test.tsx`, `src/dev-diagnostics.ts`,
`src/scope-widths.ts`, `e2e/global-setup.ts`, `e2e/share-link.test.ts`,
`vite.config.ts` or `vitest.config.ts`.

## The two gates

Both gates judge a `@solidjs/diagnostics` capture with the same verdict,
`assertGate` in `src/diagnostics-verdict.ts`, so they cannot drift.

- The **test gate** (`src/test-setup.ts`, wired as `setupFiles` for the
  Vitest `src` project) runs every test body inside a capture with attribution
  on, in happy-dom, against the faked data seam (`src/test-fakes.ts`). It is
  fast and runs on every `bun run test`.
- The **browser gate** (`e2e/share-link.test.ts`, Vitest project `e2e`,
  `bun run test:e2e`) drives real Chromium through `playwright-core` against
  the dev server in `--mode e2e` and the anonymous local Convex deployment —
  nothing faked — over the whole Organizer path. It exists because the
  happy-dom gate cannot see everything: the per-row `<Show>` defect in
  `BracketView` was found by a human in `bun dev` while 236 tests passed.

`src/dev-diagnostics.ts` is the same engine in its watched, not enforced,
form: it turns attribution on for `bun dev` and stands down wherever a gate
owns the engine (under Vitest and in `--mode e2e`), because an app-side hold
opens a fresh window over the engine's tables and hides what the gate
recorded, and because holds combine by the most demanding request per key —
a threshold a gate turns off would stay armed beside the app's own hold.

## Why the environments differ

The gates make count-based or structural assertions wherever a wall-clock
measurement would report the harness instead of the app. Threshold posture:

| Check                                  | Test gate (happy-dom)                                                                                                                                                                                                | Browser gate (real Chromium)                                                                                                                       |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hotTime` / `[HOT_SCOPE_TIME]`         | off — the DOM is emulated in JS and five Vitest projects run concurrently; the number reports the runner                                                                                                             | engine default (8ms) — a real browser is where it means something                                                                                  |
| `fallbackFlashes` / `[FALLBACK_FLASH]` | off — it times a fallback against fixture latency, which no fixture possesses                                                                                                                                        | off — it measures the backend's latency, and the gate's backend answers over loopback                                                              |
| Silent holds                           | checked in the shared verdict (`expectNoSilentHolds`), not by an engine code: the engine emits a hold's code only past `holds.infoMs` (100ms), so a shorter unacknowledged hold is real, recorded, and coded nowhere | the same check — `assertGate` runs it on the browser artifact too; what differs between the gates is which _thresholds_ are armed (the rows above) |
| Scope width                            | fails at 30 sources on one scope (`WIDE_SCOPE_SOURCES`, below)                                                                                                                                                       | same 30, from the page's own records                                                                                                               |

The other duration-gated codes (an unacknowledged hold, a sequential-flight
waterfall) stay on in the test gate: those are shapes the app either has or
does not, and neither a slow runner nor an instant fixture invents one.
Wall-clock budgets are judged where they mean something: the dev-server
artifact loop (`POST /__solid/diagnostics` in `## Architecture Notes`) and
the browser gate.

The test gate runs on happy-dom for a structural reason: the `node`
condition resolves Solid's _server_ build, where writes are inert
(`[SERVER_WRITE]`), effects never run and the attribution tables stay empty —
a green reactive test proving nothing.

## The scope-width check

Before Solid 2.0.0-rc.14, `[WIDE_SCOPE_DEPS]` answered the per-row question
at the same threshold of 30. rc.14 exempts a list's insert effect from that
code and raises its default to 200, so the per-row cost it was trusted to
catch reached no code at all. The gates therefore count widths themselves:
`WIDE_SCOPE_SOURCES` (30) in `src/diagnostics-verdict.ts`, counted by
`src/scope-widths.ts` from the engine's `create` and `rerun` records. The
widest scope in the shipped app tracks 9.

The count reads raw source counts, which is why both gate environments
disable solid-refresh (its wrapper memo is a reactive source per component
row) and why the browser gate's mode also disables the Vite plugin's
`performanceTracks` injection (it paints engine records from inside the
scopes the gate times). The gates measure the shipped graph.

Scenario size is part of the check: the per-row defect costs the list's
insert effect one source per row, so an 8-player double elimination
(15 matches) cannot falsify it and a 16-player one (31 matches) can. The
browser scenario stays at 16 players for that reason, and
`src/bracket/BracketView.test.tsx` carries a 31-match fixture for the same
reason in the test gate.

## Evidence log

The measurements the current settings rest on. Versions are the ones in
force when each was taken.

- A 41ms unacknowledged hold shows as `silent: 1` in the attribution tables
  and reaches no channel — the reason `expectNoSilentHolds` exists beside
  `expectNoDiagnostics`.
- With the per-row defect re-injected before the local width check existed:
  31 sources on the insert effect, and both gates green.
- happy-dom: a page's first render spends 11–13ms in the memo that
  instantiates it while idle. The gate ran at a 40ms `hotTime` budget for a
  while; on a cold 4-core runner the same page render then measured 91.9ms
  (a list test, 48.3ms), green on the six runs after. A budget that reports
  the runner is a gate that cries wolf, and its failure names an innocent
  page.
- `[FALLBACK_FLASH]` (engine 2.0.0-rc.10 on): measured the day it arrived,
  89 findings across 34 page tests, every one between 1ms and 25ms, on code
  that had not changed.
- Browser gate over loopback: six fallbacks of 1.7–37ms on the scenario,
  every one a local subscription's first value.
- With the defect re-injected in the browser: 31 sources on both the
  management page and the Share Link; on the shipped code, nothing at
  either size.
- With solid-refresh on in `--mode e2e`, the shipped code tracks the same
  31 sources, all `[solid-refresh]MatchCard`. With `performanceTracks` on,
  the `<Show>` that instantiates the management page and the roster's
  `<For>` measured 13.8ms and 14.2ms against the 8ms `[HOT_SCOPE_TIME]`
  budget; under it with the tracks off, on the same code and container.
- The preinstalled Chromium (141) on this scenario tripped
  `[HOT_SCOPE_TIME]` twice, at 8.1ms and 8.3ms, where the pinned headless
  shell passes — the reason the browser gate installs its own shell rather
  than substituting the preinstalled build.
- The browser gate's `fallbackFlashes: false` reported six findings until
  the app stood down in `--mode e2e` — the hold-combination behaviour
  described above (engine 2.0.0-rc.10 on; before that, a second `enable()`
  replaced the options and cleared the tables outright).
- Convex 1.46 does not re-push after a missing-env failure in the way the
  auth-key retry needs; the header of `e2e/global-setup.ts` is the
  canonical account of the two-call `auth:keys` behaviour and the restart
  it forces.
- A per-row `<Show>` in `BracketView` made every row a source of the
  list's insert effect and reported in the browser at 15 matches while
  all four bracket tests passed — the measurement behind the 31-match
  fixture in `src/bracket/BracketView.test.tsx`.
- The `e2e-gate` job in `deploy.yml` was promoted from pull-request-only
  after the browser gate ran green on every pull request from the Solid
  rc.21 baseline move through the 2026-11-14 toolchain series — the
  stability its earlier by-choice deferral asked for. A red gate on
  `main` sits in front of the deploy on purpose.

## Global-setup boot model

`e2e/global-setup.ts` boots what the browser gate needs, three ways in
order of preference: nothing, when `E2E_BASE_URL` is set; only the dev
server, when a _local_ `convex:dev` already answers (a cloud URL is never
reused); otherwise `convex dev` as well, on the anonymous deployment named
by a private `--env-file`, restarted once after `auth:keys` when the first
push reports the auth keys missing.

Safety invariants: the target is asserted local before the app starts, so
the gate cannot write tournaments to a cloud deployment; `.env.local` is
snapshotted first and restored on teardown (the anonymous CLI saves its
deployment there); the dev server receives `VITE_CONVEX_URL` in its
environment, which Vite ranks above `.env.local`; children die with the
run as a whole process group, waited on until every member is gone,
because the backend binary outlived a teardown that only waited for the
leader. Mechanics: the header of `e2e/global-setup.ts`.

## Re-proving the browser gate by hand

The proof that the browser gate fails on the defect is not automated — it
would mean editing `BracketView.tsx` under a running dev server from
inside a test. Re-measure it by hand when the scenario or the thresholds
change:

1. In `src/bracket/BracketView.tsx`, add
   `const byKey = createMemo(() => new Map(props.matches.map((m) => [m.key, m])))`.
2. Make the cards `<For>` iterate `layout().cards` and narrow each row's
   match with `<Show when={byKey().get(card().key)}>` (the shape
   `src/diagnostics-gate.test.tsx` uses).
3. Run `bun run test:e2e`.
4. Expect `Expected no scope to track 30 sources or more`.
5. Restore the file.

## Canonical sources

- `src/test-setup.ts` — the test gate's contract and threshold comments.
- `src/diagnostics-verdict.ts` — `assertGate` and `WIDE_SCOPE_SOURCES`.
- `src/scope-widths.ts` — how widths are counted.
- `src/dev-diagnostics.ts` and `src/dev-diagnostics.test.tsx` — the
  stand-down behaviour, measured on both sides.
- `e2e/global-setup.ts` — the boot mechanics, in its header.
- `e2e/share-link.test.ts` — the browser scenario and its header.
- `vite.config.ts` — the `--mode e2e` switches (refresh,
  `performanceTracks`) and why they are off there.
