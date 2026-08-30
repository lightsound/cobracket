# cobracket — Product Vision

Settled in the grill-with-docs sessions of 2026-08. Vocabulary lives in [`CONTEXT.md`](../CONTEXT.md); hard-to-reverse decisions live in [`docs/adr/`](./adr/). This document holds everything else: the why, the scope, and the current plan. Sections marked "current plan" are expected to evolve; the rest is settled direction.

## Problem

Existing tournament tools are slow, dated in design, and confusing to operate. Hosting even a small community tournament demands more work from the Organizer than it should. Modern tech (realtime-first backend, fast UI) and AI (chat-driven operation) can replace them.

## Product

**cobracket lets anyone easily host and manage a tournament of any format — from the web, or from chat.**

Differentiators, in order:

1. **Chat operations via MCP** (ADR 0001): an Organizer runs a tournament from their own AI client. Almost no existing tool offers this.
2. **Zero-friction start** (ADR 0003): no sign-up — create a tournament anonymously in seconds, upgrade to an account later.
3. **Fast, modern, realtime UI**: spectators watch the bracket update live through the Share Link.

## North star

The long-term shape of cobracket is a full competitive-season loop, for any competitive discipline — games and physical sports alike, worldwide:

> Host an Event → participants register → tournaments run → results are recorded → results feed Seeding within the discipline (winning a large tournament raises your seed) → a period's results aggregate into Rankings → the next season begins.

Today communities assemble this by hand on top of start.gg-style APIs, with someone aggregating results into homemade rankings. cobracket automates the loop, supporting both community-run rankings (their own criteria) and official ones. No existing app covers the whole loop. Event hosting (luma-style, including registration) must be MCP-operable like everything else.

Events, registration, rankings, and seasons are direction, not MVP scope; the MVP stays a standalone tournament. Settled so far:

- The **Event is the container**, deliberately inverting start.gg's vocabulary (where "tournament" contains "events"). A tournament can also exist standalone, outside any Event — the MVP depends on that.
- An Event can host **multiple Tracks** (registration units) — different games in one event, or pro and amateur brackets of the same game. A Track can declare which other Tracks it cannot be combined with (luma has no such mechanism; this is cobracket's own).
- A **plain Event with no tournament is valid**; a Track can be turned into a tournament later. Detaching (un-tournamentizing) is allowed only while no result is recorded; after that it is simply impossible.
- **Brackets are published before event day** — players prepare, spectators anticipate matchups. Check-in (QR-based, luma-style) confirms attendance; no-shows become Walkovers, never a regenerated bracket.
- **Event mechanics follow luma as the reference**: capacity, approval-based registration, waitlists, invitations/unlock codes for invited players, QR check-in with express scanning. Recurring events are served by cloning an Event (participants reset, everything else copied) rather than a recurrence system.
- **Season windows are defined by the ranking's publisher**, not globally: cobracket official might publish semiannually while a community runs monthly windows over the same discipline. Windows can also be rolling (ATP-style "last 12 months"), not only fixed seasons.
- cobracket official can publish **multiple rankings per discipline**, one per measurement Method; each Ranking also scopes which tournaments it counts (a community counts its own events; official counts the discipline at large).
- **Rankings attach to Players, not Participants.** The dependency chain this creates: participant self-entry and Player accounts (with claiming of organizer-entered results) must exist before rankings can.
- Disciplines are **freeform at first** (organizer-entered with suggestions); official curation arrives only where official rankings do.

## Audience and market

- First audience: **game and esports community tournaments** (Discord-centric culture).
- Core scale: **8–64 participants** per tournament.
- Market: **global from day one.** UI is English-first with Japanese also provided (i18n structure from the start). Source code, docs, and commits are English only.

## Formats

Five families, no custom formats (ADR 0002): single elimination, double elimination, round robin, Swiss, group stage into playoffs.

## Roles

- **Organizer**: operates everything. Anonymous by default, upgradeable to an account.
- **Participant / Spectator**: view-only through the Share Link, realtime, no account.
- Participant self-reporting of results and co-organizing are post-MVP candidates.

## MVP scope (current plan)

Formats: **single elimination and double elimination.**

Organizer flow: create tournament → enter participants (typed or pasted as a name list; no self-entry) → seeding (random by default, manual reordering) → generate bracket → record results (an outcome plus an optional score) → tournament completes. The app surfaces "in progress / up next" matches; table assignment is out.

Chat: **MCP server** wrapping the same operations API as the web UI. The MCP client authenticates with a token issued from the web UI (an anonymous Organizer can issue one too).

Explicitly not in MVP: Discord bot, in-app AI assistant, participant accounts, co-organizers, round robin / Swiss / group stages, payments, ads.

## Design principles

Settled in the final audit rounds; each is nearly free on day one and expensive to retrofit:

- **Results are the source of truth** (ADR 0005): brackets, standings, seeding, and rankings are derived and recomputable; corrections are first-class; every result records its actor and time.
- **Match outcomes are general**: win, loss, draw, walkover, disqualification. Draws exist in some disciplines and round robin is in scope, so "winner required" is never baked into the schema; whether draws are allowed is per-tournament configuration.
- **Disciplines can alias and merge** from day one: freeform entry will produce "SF6" vs "Street Fighter 6"; the schema must let them merge later with results following, or ranking data rots.
- **Visibility is a field from day one**: public / unlisted / private on tournaments and events. MVP behavior is unlisted only.
- **Display names are separable from identity**: a Player can be pseudonymized on request without breaking recorded results or brackets.
- **Participant self-reporting (post-MVP) is symmetric**: either participant of a match can report the result; the opponent confirms or disputes; conflicting reports escalate to the Organizer, whose entry always wins. ADR 0005 (auditable, correctable results) is what makes auto-advancing the bracket on self-reports safe. At major scale (2,000+ entrants) this, plus match-call notifications, is what keeps operations light.

## Monetization hypothesis

- **Hosting and running a free-entry tournament is free, forever.** That promise is what moves people off existing tools.
- Revenue: (1) a cut of entry fees on paid-entry tournaments — post-MVP, built on a platform payment provider (Stripe Connect-style; in Japan this touches funds-settlement regulation, so it is a deliberate later investment); (2) ads on Spectator pages (Share Link views) only — never on Organizer screens, which would undercut the "pleasant to operate" positioning.
- An "entry fee" field may appear early to measure demand before payments exist.

## First milestone

Run one real community tournament (8–16 participants) end to end on cobracket alone. Personal connections may supply this tournament but are not counted on; self-hosting one counts.

## Roadmap candidates after MVP

Rough order: luma-style Event hosting with Tracks, registration, and check-in (MCP-operable — the north-star loop starts here, and registration removes the name-typing pain) → Discord bot as the second chat surface, once the operations API covers Events → participant self-reporting and co-organizers (Communities) → remaining format families → Player accounts with claiming of past results → rankings and seasons (community-run and official, feeding seeding) → spectator-page ads → paid-entry tournaments with fee collection.

## Open questions

- **Team competitions**: some disciplines are inherently team-based. Whether rankings score the team, its members, or both is unresolved.
- **Official-ranking eligibility**: anyone can host events, so official Rankings cannot count arbitrary tournaments — farmed or fake events must not move official standings. The eligibility criteria (minimum size, community reputation, manual curation, verified events) are unresolved.
- **Claim verification**: how a Player's claim of an organizer-entered Participant record is verified, and how disputes are handled.

## Spec-stage checklist

Deferred deliberately — none of these threaten the domain model, but they must not be forgotten when the relevant spec is written:

- Walkover cascades: mid-tournament withdrawal or disqualification propagation rules
- Best-of-N match detail (per-game results) as an additive extension to the outcome-plus-score result
- Composite format modeling: whether group-stage-into-playoffs is one tournament with phases or chained tournaments
- Season boundaries and timezones (store UTC; the publisher picks the boundary timezone)
- Spectator-scale reads: a popular Share Link can have orders of magnitude more viewers than participants
- Seeding provenance: record which Ranking edition seeded a bracket
- Day-of operation under poor venue connectivity (the stack is online-first)
- Match-call notifications for participants at large events
- Anti-spam and rate limiting for anonymous tournament and event creation
- Rendering and querying very large brackets: a major can exceed 2,000 entrants — the core design target stays 8–64, but the schema must not hard-cap size
- Global read latency from a single-region Convex deployment
- Public read API / data export for communities (roadmap candidate)
