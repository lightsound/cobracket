# cobracket

> **Context note (2026-11-15):** this INFO.md was written for the
> November 2026 deepsec audit run (executed by Muse on a snapshot
> of `main` @ `244fcb96`) and was carried into this repository
> unchanged except for this note. It describes the codebase as of
> that snapshot; update it when the architecture moves.


<!-- Snapshot: lightsound/cobracket @ main 244fcb968b4220c5b3f71c07a6ba7d0aec6900a3. Source, configs and workflows only — docs, agent-config dirs, generated code (convex/_generated, spacetimedb/bindings) and the lockfile were not copied. -->

## What this codebase does

cobracket is a single-elimination / double-elimination tournament
bracket organizer: a Solid 2 SPA (`src/`, hosted as static assets on
Cloudflare) talking to a backend API. Organizers create tournaments,
manage rosters, generate brackets, and record results; recorded
results are the source of truth and bracket progression is derived by
a pure format engine (`spacetimedb/format/`, shared by both backends).
A published tournament gets a share link anyone can view read-only.

Two backends implement the same operations API behind one client seam
(`src/lib/backend.ts`, selected by env): **Convex (`convex/`) is the
production backend today**; a SpacetimeDB module (`spacetimedb/src/`)
plus a TS client adapter (`src/lib/spacetimedb.ts`,
`src/lib/spacetimedb-model.ts`) is the pre-release migration target
and is only ever run against local standalone instances (tests, e2e).

## Auth shape

- Convex: Convex Auth v2 (preview) with **anonymous sign-in only**
  (`convex/auth.ts`). Every function learns the caller through
  `getOrganizer` — identity comes from the verified JWT, never from
  client arguments. Ownership/lifecycle guards live in
  `convex/model/guards.ts`: `requireOrganizer`,
  `findOwnedTournament` / `requireOwnedTournament` ("missing" and
  "not yours" deliberately read the same), `requireStatus`.
- Share links: the slug is a bearer capability. The unauthenticated
  query `getSharedTournament` (`convex/share.ts`) returns a tournament
  only when it is published and not `visibility: "private"`.
- SpacetimeDB: connection `Identity` is bound to an app user via the
  `identityUser` table (`spacetimedb/src/lib/binding.ts`); reads are
  sender-gated views, writes are reducers whose first act consults the
  binding (`spacetimedb/src/lib/guards.ts` mirrors the Convex guards).
  Reducer refusals are thrown as `SenderError` so the message reaches
  the caller; anything else is an internal fault.

## Threat model

Production exposure is narrow by design: the Convex deployment is
used by the owner for design review, its URL is unshared, and there
are no external users yet — but the code is written as if the
deployment were public, and findings should be judged on the code,
with exposure stated separately. In-model attackers: an anonymous
visitor (anyone can mint an anonymous session, so "signed in" is a
weak gate — ownership checks are the real boundary), a share-link
holder probing slugs, and a malicious or compromised dependency /
CI action. Ranked: (1) cross-organizer access — reading or mutating
another organizer's tournament by bypassing the ownership guards;
(2) share-surface leakage — drafts or private tournaments becoming
visible, or slug guessing made feasible; (3) CI/deploy compromise —
`.github/workflows/deploy.yml` holds the production deploy secrets
(CONVEX_DEPLOY_KEY, Cloudflare token) when configured; test/e2e
drivers download a pinned SpacetimeDB standalone binary at runtime.
