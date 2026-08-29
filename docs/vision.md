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

Organizer flow: create tournament → enter participants (typed or pasted as a name list; no self-entry) → seeding (random by default, manual reordering) → generate bracket → enter results (winner plus optional score) → tournament completes. The app surfaces "in progress / up next" matches; table assignment is out.

Chat: **MCP server** wrapping the same operations API as the web UI. The MCP client authenticates with a token issued from the web UI (an anonymous Organizer can issue one too).

Explicitly not in MVP: Discord bot, in-app AI assistant, participant accounts, co-organizers, round robin / Swiss / group stages, payments, ads.

## Monetization hypothesis

- **Hosting and running a free-entry tournament is free, forever.** That promise is what moves people off existing tools.
- Revenue: (1) a cut of entry fees on paid-entry tournaments — post-MVP, built on a platform payment provider (Stripe Connect-style; in Japan this touches funds-settlement regulation, so it is a deliberate later investment); (2) ads on Spectator pages (Share Link views) only — never on Organizer screens, which would undercut the "pleasant to operate" positioning.
- An "entry fee" field may appear early to measure demand before payments exist.

## First milestone

Run one real community tournament (8–16 participants) end to end on cobracket alone. Personal connections may supply this tournament but are not counted on; self-hosting one counts.

## Roadmap candidates after MVP

Rough order: Discord bot as the second chat surface → participant self-reporting and co-organizers → remaining format families → account upgrade polish and tournament history → spectator-page ads → paid-entry tournaments with fee collection.
