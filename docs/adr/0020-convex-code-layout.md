# Convex code layout: top-level files are API modules, subdirectories are libraries

`convex/operations.ts` had grown to about 1,070 lines for the MVP alone, half of it validators, guards, and view assembly, and Event hosting (`docs/specs/events.md`) adds Events, Tracks, Entries, Grants, Activities, and internal functions — the settle cron, deletion batches, delivery writers — that must share one write path with the public functions ("the one module that changes Entry states"). We split it along one structural rule:

- **A top-level file in `convex/` is an API module.** It registers functions — public and internal — and nothing else registers any. The operations API of ADR 0001 and 0009 is the set of public functions these modules register; `tournaments.ts`, `roster.ts`, `bracket.ts`, `share.ts`, and `disciplines.ts` today, `events.ts`, `tracks.ts`, `entries.ts`, `settle.ts` and the rest as Events land. Files whose place Convex fixes (`schema.ts`, `auth.ts`, `crons.ts`, a future `http.ts`) are top-level already, so the rule has no exceptions.
- **A subdirectory is a library.** `convex/model/` holds what API modules share — validators, guards, limits, loading and views, and the write modules every path must go through — which is Convex's own recommendation ("most of your code should live in a directory like `convex/model`", best practices). Pure engines with no Convex dependency (`convex/format/`, and later the registration decision function and `canView`) stay sibling packages.
- **Both halves are enforced.** Oxlint's `no-restricted-imports` refuses `query`, `mutation`, `action`, their internal forms, and `httpAction` from `_generated/server` anywhere in `convex/` except a top-level file. ImportLint keeps `convex/model` package-private: only its `index.ts` re-exports leave the directory (the index loophole lifts them to the `convex` package), so API modules import `./model` while `src/` cannot reach it at all — measured both ways.

Public functions keep using Convex's registrars directly and call a `require*` / `can*` guard at the top of their handlers, because that is the shape `@convex-dev/require-access-control` checks; it does not inspect custom function wrappers.

## Considered Options

- **Everything under `convex/operations/`** (API modules there, helpers in `operations/lib/`). Groups the API in one folder, but the lint rule needs two exceptions (`auth.ts` outside it, `lib/` inside it), and every function path gains a segment (`api.operations.tournaments.createTournament`).
- **Only public functions in `operations/`, internal ones elsewhere.** Internal functions such as settle could not import the write modules kept private to `operations/` without publishing them app-wide or duplicating them.
- **Libraries outside `convex/`** (a sibling `backend/` directory). fallow would then see unused exports in them, which it cannot inside `convex/` (below). But `src/` and `backend/` are siblings, so ImportLint's index loophole cannot reach `convex/`: the exports would have to be `@public`, visible to `src/` too, and a fallow zone would be needed to close that again; and it leaves Convex's documented layout. Better on one axis, worse on two.
- **Moving the Convex functions directory itself** (for example to `server/convex/`, with libraries in `server/`), so ImportLint's parent-child rule would admit `server/convex/` and exclude `src/`. Moves `_generated`, every client import, and fallow's Convex detection for the same gain.
- **Operations declared through a wrapper** (`defineOperation`, or convex-helpers custom functions) that resolves identity and could generate MCP tools. Hides every function from `require-access-control`. Exposing operations to MCP can read `convex function-spec` instead, which lists every public function with its validators.
- **Splitting by role** (`organizer.ts`, `registrant.ts`, `public.ts`). Entry operations belong to both Organizers and Registrants, so one subject would be spread over files.
- **Convex Components for Events.** A component owns its tables, and Participants and Entries reference each other across what would be the boundary.

## Consequences

- Function paths are `api.<module>.<function>` (`api.tournaments.createTournament`). Names stay verb-plus-noun and unique across modules, so they read the same as future MCP tool names.
- fallow's Convex plugin treats every file under `convex/` as an entry point and credits all its exports, so `fallow dead-code` does not report an unused export in `convex/model/` or `convex/format/` (measured; `--include-entry-exports` does not change it). This held before the split and holds under every layout that keeps libraries in `convex/`; dead helpers there are found by reading, or by `fallow dead-code --trace`.
- `convex/operations.test.ts` keeps testing the operations API as a whole (Seam 2), through every module.
