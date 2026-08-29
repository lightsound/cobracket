# MVP: Standalone Tournament

Synthesized from the grill-with-docs sessions of 2026-08. Vocabulary per [`CONTEXT.md`](../../CONTEXT.md); constrained by [ADR 0001–0005](../adr/). The product frame lives in [`docs/vision.md`](../vision.md); this spec covers only the MVP slice.

## Problem Statement

An Organizer who wants to run a small community tournament (8–64 participants, typically a game or esports meetup) has no tool that is fast, pleasant, and simple. Existing tools are slow, dated, and confusing; setting up a bracket and keeping it updated during the event demands more attention than the event itself. Participants and spectators have no live view of the bracket without accounts and friction.

## Solution

A tournament in seconds, from the web or from chat: an Organizer opens cobracket, creates a Tournament with zero sign-up (anonymous identity, ADR 0003), enters participant names, generates a single- or double-elimination Bracket, and runs the whole thing — results, progression, completion — from a fast realtime UI or from their own AI client through the cobracket MCP server (ADR 0001). Everyone else follows along live through a Share Link, no account needed.

## User Stories

1. As an Organizer, I want to create a Tournament without signing up, so that I can get started in seconds.
2. As an Organizer, I want to name the Tournament and set its Discipline (freeform with suggestions), so that the tournament is identifiable and its results are attributable to a discipline later.
3. As an Organizer, I want to choose a Format — single elimination or double elimination — so that the bracket matches how we play.
4. As an Organizer, I want to add Participants by typing names one by one, so that I can build the roster as people show up.
5. As an Organizer, I want to paste a whole list of names at once (one per line, e.g. copied from Discord), so that entering 32 participants takes seconds.
6. As an Organizer, I want to rename or remove a Participant before the bracket starts, so that typos and dropouts are cheap to fix.
7. As an Organizer, I want Seeding to be random by default, so that I don't have to think about placement when I don't care.
8. As an Organizer, I want to manually reorder the Seeding, so that known strong players don't meet in round one.
9. As an Organizer, I want to generate the Bracket and see it before anyone else does, so that I can sanity-check it.
10. As an Organizer, I want to regenerate the Bracket freely until the first result is recorded, so that late roster changes are painless.
11. As an Organizer, I want the Bracket published in advance of play, so that players can prepare and spectators can anticipate matchups.
12. As an Organizer, I want to record a Match result as an outcome (win, draw where the format allows, walkover, disqualification) plus an optional score, so that the bracket advances with the level of detail I want.
13. As an Organizer, I want a no-show recorded as a Walkover, so that the published bracket never has to be regenerated for absences.
14. As an Organizer, I want to correct a previously recorded result, so that a mis-entry discovered rounds later doesn't ruin the tournament (ADR 0005).
15. As an Organizer, I want to see which Matches are in progress and which are up next, so that I can keep the event moving without a paper run sheet.
16. As an Organizer, I want the Tournament to complete automatically when the final resolves, so that final standings appear without extra steps.
17. As an Organizer, I want to copy a Share Link, so that I can drop one URL in the group chat and be done with communication.
18. As an Organizer, I want to issue an MCP token from the web UI, so that my AI client can operate my tournaments.
19. As an Organizer, I want to revoke an MCP token, so that a leaked token stops working.
20. As an Organizer using an AI client, I want to do everything stories 1–16 cover through MCP tools, so that I can run a tournament from chat (ADR 0001).
21. As a Participant, I want to open the Share Link and see the live Bracket, my next opponent, and results as they land, so that I know when I play without asking the Organizer.
22. As a Spectator, I want the Share Link to work with no account and update in real time, so that following the tournament is effortless.
23. As a Spectator, I want final standings visible on the Share Link after completion, so that the record of the tournament persists.
24. As an Organizer, I want the UI in English or Japanese, so that my community can use it in its own language.
25. As a returning Organizer, I want my anonymous identity to persist in my browser, so that my tournaments are still mine when I come back.

## Implementation Decisions

**Domain model.** MVP entities: Tournament, Participant, Match (with results), plus the Organizer identity and MCP tokens. No Event, Track, Entry, Player, Community, Ranking — but nothing in the schema may preclude them: Participants stay tournament-local records (linkable to a Player later), Disciplines are stored so alias/merge is possible later, and Tournaments carry a visibility field (public/unlisted/private) even though MVP behavior is unlisted-only.

**Results are the source of truth (ADR 0005).** Recorded results are append-style records carrying outcome, optional score, actor, and timestamp. Bracket progression, current/next match, and final standings are derived and recomputable. Correcting a result recomputes downstream progression; downstream results whose pairing becomes invalid are voided and must be re-entered. The bracket structure (slots, byes, seeding) is fixed at generation; only results move it.

**Outcomes.** Win, loss, draw, walkover, disqualification. Single and double elimination disallow draws (per-tournament draw configuration ships with the schema but stays off for both MVP formats). Byes are bracket structure created at generation for non-power-of-two rosters — distinct from Walkovers, which are results.

**Format engine.** A pure module: (participants + seeding + format options) → bracket structure; (bracket structure + results) → progression and standings. Single and double elimination only, but the interface must keep round robin, Swiss, and group-into-playoffs implementable without redesign (ADR 0002). Double elimination includes the grand-final bracket reset (losers-side winner must win twice), on by default. No third-place match in MVP.

**Lifecycle.** Draft (roster and seeding editable, bracket regenerable) → published (bracket visible on the Share Link) → live (first result recorded; roster locked, regeneration locked) → completed (final resolved; automatic). Mid-tournament dropouts are handled by the Organizer recording walkovers match by match; automated DQ cascades are deferred.

**Operations API.** One set of Convex functions covers every Organizer capability; the web UI and the MCP server are both thin clients of it (ADR 0001). MCP tokens are issued and revoked from the web UI, work for anonymous Organizers, and authenticate the MCP server as that Organizer.

**Auth.** Convex Auth v2 (preview) Anonymous Sign-In, isolated behind a single auth module exposing only the current Organizer identity; ImportLint enforces the boundary (ADR 0003). No account upgrade flow in MVP.

**Frontend.** Solid 2.0 per the repo's rules: async data as computations under Loading/Errored boundaries, stores reconciled from Convex subscriptions, keyed `<For>` rows. The Share Link page is a realtime read-only view of the same derived bracket state the Organizer sees. UI strings go through an i18n layer from the first screen; English first, Japanese provided.

**Visibility of admin vs public.** The Share Link is the tournament's public URL (unlisted). Organizer capabilities exist only behind the Organizer's identity — there is no secret admin link.

## Testing Decisions

- Good tests assert external behavior: results in → progression, standings, and current/next matches out. No tests against internal bracket bookkeeping.
- **Seam 1 — the format engine (pure)**: the bulk of tests live here. Property-style coverage for single and double elimination: any roster size (byes), walkovers, DQs, grand-final reset, correction/void recomputation.
- **Seam 2 — the operations API (Convex functions)**: lifecycle tests through the same functions the UI and MCP server call — create → roster → generate → publish → report → correct → complete — using `convex-test`. This seam is deliberately the only integration surface; the MCP server needs no separate behavioral tests beyond tool-wiring.
- The repo has no tests yet; these establish the pattern. `flush()` before observing state in any Solid-side test, per repo rules.
- UI is exercised through the real app (two dev processes, per AGENTS.md) rather than component tests in MVP.

## Out of Scope

Events, Tracks, Entries, check-in, participant self-entry and self-reporting, Player accounts and claiming, Communities and co-organizing, rankings/seasons/methods, round robin / Swiss / group stages, third-place matches, automated DQ cascades, late roster additions after the first result, table/station assignment, match-call notifications, Discord bot, in-app AI assistant, payments, ads, account upgrade from anonymous, public/private visibility behavior (field only), custom formats (ADR 0002 — permanently out).

## Further Notes

- Success milestone: one real community tournament (8–16 participants) run end to end on cobracket alone.
- The existing `tasks` demo (schema, functions, UI) is template scaffolding to be replaced, not extended.
- The spec-stage checklist in `docs/vision.md` lists deferred items that must be revisited when their feature areas open.
