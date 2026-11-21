# Diagnostics gates

The operative contracts for the two diagnostics gates live in `AGENTS.md`
(`## Architecture Notes` and `## Commands`). Implementation mechanics live in
the headers of the source files named below — except the browser gate's boot
mechanics, which live in this document's Global-setup boot model section.
This document holds what neither of those places owns cleanly: how the gates
fit together, why their environments differ, the measurements the settings
rest on, and the manual procedure for re-proving the browser gate.

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
  the dev server in `--mode e2e` and a local SpacetimeDB standalone with
  the real module published —
  nothing faked — over the whole Organizer path. It exists because the
  happy-dom gate cannot see everything: the per-row `<Show>` defect in
  `BracketView` was found by a human in `bun dev` while 236 tests passed.

`src/dev-diagnostics.ts` is the same engine in its watched, not enforced,
form: it turns attribution on for `bun dev` and stands down wherever a gate
owns the engine (under Vitest and in `--mode e2e`), because an app-side hold
opens a fresh window over the engine's tables and hides what the gate
recorded, and because holds combine by the most demanding request per key —
a threshold a gate turns off would stay armed beside the app's own hold.
Its hold sets `log: false`: the engine's why-chain would bury the coded
findings in the console, and a per-run trace is available on demand through
`costs()` / `feedback()` / `why()`. Since `@solidjs/web` 2.0.0-rc.14, the
`performanceTracks` hold asks for the six cost checks off; the app-side
hold keeps them on. The hold lasts as long as the page, so it is the
background every gate threshold is judged against.

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
- Convex 1.46 did not re-push after a missing-env failure in the way the
  auth-key retry needed; the two-call `auth:keys` behaviour and the
  restart it forced belonged to the browser gate's Convex boot, whose
  canonical account was the header of `e2e/global-setup.ts` until
  migration slice M4 replaced that boot with the SpacetimeDB one.
- A per-row `<Show>` in `BracketView` made every row a source of the
  list's insert effect and reported in the browser at 15 matches while
  all four bracket tests passed — the measurement behind the 31-match
  fixture in `src/bracket/BracketView.test.tsx`.
- The `e2e-gate` job in `deploy.yml` was promoted from pull-request-only
  after the browser gate ran green on every pull request from the Solid
  rc.21 baseline move through the 2026-11-14 toolchain series — the
  stability its earlier by-choice deferral asked for. A red gate on
  `main` sits in front of the deploy on purpose.
- After the router upgrade, create-then-open and Share Link navigations
  reported two silent holds (43ms and 16ms) where neither navigation had
  reported one before — the measurement behind the router's opt-in
  `links: pendingLinks` (`data-pending`) in `src/router.ts`.
- On the Vitest side, at 40 rows: plain element rows cost the list's
  insert effect 0 sources, component rows 1 source each, and rows with a
  per-row `<Show>` 2 — the counts behind disabling solid-refresh in the
  test gate as well as in `--mode e2e`.
- Page boundaries, measured in Chromium against a local deployment with
  100ms of one-way latency: when every page called `createOrganizer()`
  for itself, the Home boundary showed its "Checking your session…"
  fallback for 200ms and the tournament list behind it for another
  200ms — the engine names the pair an `[ASYNC_WATERFALL]`. The
  management page reached from Home answered in 2ms, because the router
  had created it before disposing the old page; the one app-wide
  subscription in `src/organizer.tsx` gives every page that behaviour.
- The same setup, for link-intent preloading: every page boundary
  showed its fallback for one round trip (200ms) after navigation, and
  under 150ms of latency the same wait reads as a flicker
  (`[FALLBACK_FLASH]`). A preload on `"initial"` intent would gain
  nothing — the page subscribes on mount anyway — and for the two
  Organizer-gated reads it would run before the session is restored, so
  it is skipped. Router 2.0.0-next.37 preloaded on hover by default,
  but its focus and touch listeners were gated on `evt.button`, which
  those events lack, so they never fired; since next.38, preloading is
  opt-in (`preloadLinks: intentPreload()` — hover after a 20ms rest,
  focus and touch).

## Global-setup boot model

`e2e/global-setup.ts` boots what the browser gate needs, three ways in
order of preference: nothing, when `E2E_BASE_URL` is set; only the dev
server, when `.env.local` sets `VITE_SPACETIMEDB_HOST` and
`VITE_SPACETIMEDB_DB` and a _local_ standalone already answers (a cloud
host is never reused) — the current module is published to the reused standalone first, since it republishes nothing itself; otherwise a
standalone as well, on the gate's own port, with the module published to
a database that exists only for the gate. An `.env.local` value that does
not parse as a local URL selects nothing: mode 2 falls through to mode 3
rather than dying on the parse.

Safety invariants: the target is asserted local before the app starts —
the mode-3 publish host is built from a loopback literal and the gate's
own port, asserted free before the server starts, the database name is a
constant of the setup, and the publish names `--server` explicitly — so
the gate cannot publish to Maincloud or write tournaments to a cloud
deployment; the dev server receives its backend configuration in its
environment, which Vite ranks above `.env.local`; children die with the
run as a whole process group, waited on until every member is gone,
because a server outlives a teardown that only waits for the leader.
Nothing in the setup writes `.env.local`: the anonymous-Convex boot
snapshotted and restored it because that CLI saved its deployment there
whatever it was told to read; no counterpart exists now.

Mechanics. Binaries come from `SPACETIME_BIN_DIR`, the connection
suite's cached store, or the official release tarball — pinned by
SHA-256 and failing closed on a mismatch — downloaded into the gate's
own build directory. Both binaries' versions are asserted (2.15.0)
before the publish: the gate asserts the wire behaviour of one exact
server release, the standalone serves and the CLI publishes, and a stale
or mismatched binary would prove things about the wrong server. The
standalone driver mirrors the connection suite's
(`spacetimedb/connection/global-setup.ts`) and the live suite's
(`src/lib/spacetimedb.live.test.tsx`) deliberately — each driver stays
self-contained rather than coupling CI-gated suites to one another. The
module is assembled as package.json + tsconfig.json + src/ + format/ in
the repo's own layout, the real entry with nothing rewritten, and the
data directory is fresh per run, so the gate's database starts empty.

Signing keys: a fresh standalone data directory needs explicit key
paths, so the CLI's own pair under `~/.config/spacetime` serves when it
exists and an equivalent ES256 pair is minted under the build directory
otherwise. The private key must be PKCS#8 — the form the CLI itself
writes; a SEC1 EC key (`openssl ecparam`'s output) is rejected with
InvalidKeyFormat (measured by the connection suite on a fresh-HOME run,
the case CI always hits), so keys are minted with `openssl genpkey`, a
cached key in the rejected form is regenerated rather than reused, and
the public half is always re-derived from the private half, so a missing
or foreign `.pub` can never reach the server as half of a mismatched
pair.

After every publish, the module secret is seeded (ADR 0032) with a fresh
host-CSPRNG key, before the app starts: tournament creation mints share
slugs from the secret, so an unseeded database would refuse the
scenario's first write. Mode 3's database is fresh, so the seed always
lands there; mode 2 republishes to a developer's long-running
standalone, whose database the local flow may already have seeded — that
one refusal ("already seeded") is the state the gate needs anyway, so it
is accepted, and any other failure is real.

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
- `e2e/global-setup.ts` — the boot mechanics (Global-setup boot model,
  above); its header points here.
- `e2e/share-link.test.ts` — the browser scenario and its header.
- `vite.config.ts` — the `--mode e2e` switches (refresh,
  `performanceTracks`) and why they are off there. Since vite-plus
  next.47, its `diagnostics: true` also fails the dev server loudly if
  `@solidjs/diagnostics` goes missing, instead of serving without the
  bridge.
