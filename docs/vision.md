# cobracket — Product Vision

Settled in the grill-with-docs sessions of 2026-08. Vocabulary lives in [`CONTEXT.md`](../CONTEXT.md); hard-to-reverse decisions live in [`docs/adr/`](./adr/). This document holds everything else: the why, the scope, and the current plan. Sections marked "current plan" are expected to evolve; the rest is settled direction.

## Problem

Existing tournament tools ask more of a small community Organizer than the tournament does, and the incumbents want an account from every participant who registers, checks in, or reports a result. (That they are also slow, dated in design, and confusing to operate is the owner's impression and the motivation for cobracket; it was not checked against organizer reviews — see [`docs/competitors.md`](./competitors.md).) Modern tech (realtime-first backend, fast UI) and AI (chat-driven operation) can do better.

## Product

**cobracket lets anyone easily host and manage a tournament of any format — from the web, or from chat.**

**It serves the Organizer first** (owner, 2026-10-22). Participants and spectators use whatever platform the Organizer chose — they have no say in it — so winning the Organizer wins everyone else, and what matters most in building cobracket is lowering the burden of the people who run tournaments. Treating Organizers generously is the strategy, not a courtesy; what it means for money is under "Monetization hypothesis" below.

Differentiators, in order:

1. **Chat operations via MCP** (ADR 0001): an Organizer runs a tournament from their own AI client. No major platform (start.gg, Challonge, Battlefy, Toornament, Tonamel) offers this as of 2026-10-18, but it is no longer rare: Whistle.day, Turnale, and Turniermeister shipped write-capable MCP servers, seen September–October 2026, and the self-hosted Wizzrobe has one ([`docs/competitors.md`](./competitors.md)). What stays distinctive is one operations API shared by the web UI, MCP, and the Discord bot, reaching Events and Rankings as well as brackets.
2. **A tournament in a minute** (ADR 0003, amended by ADR 0024 on 2026-10-14): one email code, no password, no profile — then create a tournament in seconds. Registrants still need no account where the Organizer allows it.
3. **Fast, modern, realtime UI**: spectators watch the bracket update live through the Share Link, with no account. The account-free live view is the floor now rather than a difference — OFTN.GG (since 2025), parry.gg (since 2024), Whistle.day, and Tonamel all update a bracket live for anyone holding the link — so what this differentiator has to mean is the speed and finish of the page itself, measured against those four as much as against start.gg and Challonge.

## North star

The long-term shape of cobracket is a full competitive-season loop, for any competitive discipline — games and physical sports alike, worldwide:

> Host an Event → participants register → tournaments run → results are recorded → results feed Seeding within the discipline (winning a large tournament raises your seed) → a period's results aggregate into Rankings → the next season begins.

Today communities assemble this by hand on top of start.gg-style APIs, with someone aggregating results into homemade rankings (JJPR and Japan Smash Ranking for Smash in Japan, Braacket imports elsewhere). cobracket automates the loop, supporting both community-run rankings (their own criteria) and official ones. No existing app covers the whole loop for any discipline: start.gg has most of the pieces (events inside a tournament, leagues, rankings, a seed generator fed by its rankings) but gates leagues behind support approval, keeps no ranking history, and cannot rank participants without accounts; sendou.ink closes the loop for one game, Splatoon ([`docs/competitors.md`](./competitors.md)). Event hosting (luma-style, including registration) must be MCP-operable like everything else.

Events, registration, rankings, and seasons are direction, not MVP scope; the MVP stays a standalone tournament. Settled so far:

- The **Event is the container**, deliberately inverting start.gg's vocabulary (where "tournament" contains "events"). A tournament can also exist standalone, outside any Event — the MVP depends on that.
- An Event can host **multiple Tracks** (registration units) — different games in one event, or pro and amateur splits of the same game. A Track can declare which other Tracks it cannot be combined with (luma has no such mechanism; this is cobracket's own).
- A **plain Event with no tournament is valid**; a Track can be turned into a tournament later. Detaching (un-tournamentizing) is allowed only while no result is recorded; after that it is simply impossible.
- **Brackets are published before event day** — players prepare, spectators anticipate matchups. Check-in (QR-based, luma-style) confirms attendance; no-shows become Walkovers, never a regenerated bracket.
- **Event mechanics follow luma as the reference**: capacity, approval-based registration, waitlists, invitations/unlock codes for invited players, QR check-in with express scanning. Recurring events are served by cloning an Event (participants reset, everything else copied) rather than a recurrence system.
- **Season windows are defined by the ranking's publisher**, not globally: cobracket official might publish semiannually while a community runs monthly windows over the same discipline. Windows can also be rolling (ATP-style "last 12 months"), not only fixed seasons.
- **Any Community publishes Rankings** (ADR 0025): a person through their own first Community, cobracket official through the operator's. A Ranking is a publisher's reading of public results — it counts the tournaments its publisher chooses, by condition or by hand, without the Organizer's consent and never more visibly than the tournaments themselves — and every intervention and every recomputation is on record (Revisions). One publisher can publish several Rankings per discipline, each under one Method; Methods are three fixed types with named settings, never formulas (ADR 0026).
- **Abuse limits sit where something reaches other people** (ADR 0027): a robot check where a free identity is minted or a code email is sent, rate limits on the account and size limits on the container, publishing limited rather than drafting, no pre-moderation but reports and operator suspensions, nothing indexed until it is discoverable, and no account recovery on someone's word — the operator decides what is allowed, never who someone is.
- **A team is a Community with a Squad, and fans follow it** ([ADR 0028](./adr/0028-teams-are-communities-with-squads.md), 2026-10-15): the owner decided that teams exist as pages across tournaments — their tournaments, strength, members, sponsors — and that a persistent team is simply a Community carrying a standing list of Players, Communities nesting under one parent (a display-only link since 2026-10-22). A team enters a Track as an Entry with several Entrants, forming before it registers ([ADR 0029](./adr/0029-entries-and-entrants-how-teams-register.md)); a team Ranking stands chains of Entries identified by Squad or by shared players, and a team's placement is credited to the players who played ([ADR 0030](./adr/0030-team-rankings-chains-of-entries.md)).
- **Rankings attach to Players or to chains of Entries, never to Participants.** The dependency chain this creates: participant self-entry, which creates Players, must exist before rankings can; claiming of organizer-entered results need not, since a Ranking's publisher links typed names to Players inside their own Ranking until a claim replaces the link (ADR 0026).
- Disciplines are **freeform at first** (organizer-entered with suggestions); official curation arrives only where official rankings do.

## Audience and market

- First audience: **game and esports community tournaments** (Discord-centric culture).
- Core scale: **8–64 participants** per tournament.
- Market: **global from day one.** UI is English-first with Japanese also provided (i18n structure from the start). Source code, docs, and commits are English only, per the AGENTS.md language policy (which grandfathers one vendored Japanese reference).
- Competitors: [`docs/competitors.md`](./competitors.md) — the landscape as of 2026-10-18 by group, with fee benchmarks and the Japanese legal limits on fees and prizes. It is dated; re-check its fast-moving parts before relying on them.

## Formats

Five families, no custom formats (ADR 0002): single elimination, double elimination, round robin, Swiss, group stage into playoffs.

## Roles

- **Organizer**: operates everything, as a member of the Community that owns the Event or tournament (ADR 0023) — every person's first Community is created with their account, so a solo Organizer never sees the difference. An account with a verified email (ADR 0024).
- **Community**: the named group that owns Events and tournaments, publishes Rankings (ADR 0025: any Community may, over any non-private tournaments it can view), and may carry Squads of players — which is what a team is (ADR 0028). One owner, any number of admins and organizers; invitations are links (ADR 0023); Communities nest under one parent, a link that is display only, each Community governing itself (ADR 0028; the owner's call, 2026-10-22).
- **Participant / Spectator**: view-only through the Share Link, realtime, no account.
- **Registrant** (Events): registers for a Track from the Event's page, signed in with a verified email by default or anonymously on a one-player Track where the Organizer allows it (ADR 0029), and follows their own status (`docs/specs/events.md`).
- Participant self-reporting of results is a post-MVP candidate; co-organizing is specified (`docs/specs/events.md`, slice 2).

## MVP scope (current plan)

Formats: **single elimination and double elimination.**

Organizer flow: create tournament → enter participants (typed or pasted as a name list; no self-entry) → seeding (random by default, manual reordering) → generate bracket → record results (an outcome plus an optional score) → tournament completes. The app surfaces "in progress / up next" matches; table assignment is out.

Chat: **MCP server** wrapping the same operations API as the web UI. The MCP client authenticates with a token issued from the web UI to the Organizer's account (every Organizer is one, ADR 0024) and acts as them in every Community they belong to (ADR 0023). Deferred out of the MVP slice (ADR 0009); the operations-API constraint it imposes is already built.

Explicitly not in MVP: Discord bot, in-app AI assistant, participant accounts, co-organizers (since specified: `docs/specs/events.md`, slice 2), round robin / Swiss / group stages, payments, ads.

## Design principles

Settled in the final audit rounds; each is nearly free on day one and expensive to retrofit:

- **Results are the source of truth** (ADR 0005): brackets, standings, and rankings are derived and recomputable; corrections are first-class; every result records its actor and time. (Seeding is an input fixed at bracket generation, not a derived value — though future auto-seeding will consume Rankings.)
- **Match outcomes are general**: win, loss, draw, walkover, disqualification. Draws exist in some disciplines and round robin is in scope, so "winner required" is never baked into the schema; whether draws are allowed is per-tournament configuration within what the Format permits (elimination formats require a decisive outcome).
- **Disciplines can alias and merge** from day one: freeform entry will produce "SF6" vs "Street Fighter 6"; the schema must let them merge later with results following, or ranking data rots.
- **Visibility is a field from day one**: public / unlisted / private on tournaments and events. MVP behavior is unlisted only.
- **Display names are separable from identity**: a Player can be pseudonymized on request without breaking recorded results or brackets (an operator redaction, ADR 0022; account deletion itself keeps names in records).
- **Participant self-reporting (post-MVP) is symmetric**: either participant of a match can report the result; the opponent confirms or disputes; conflicting reports escalate to the Organizer, whose entry always wins. ADR 0005 (auditable, correctable results) is what makes auto-advancing the bracket on self-reports safe. At major scale (2,000+ participants) this, plus match-call notifications, is what keeps operations light.

## Monetization hypothesis

Direction settled by the owner on 2026-10-22: **cobracket earns from the people who come to watch, never from the people who run tournaments.** The mechanisms below are the current plan.

- **The Organizer side is free, forever, and cobracket takes no cut of an Organizer's money.** Free hosting of free-entry tournaments is the industry floor (start.gg, Challonge, Tonamel, and OFTN.GG up to 32 players all offer it), so cobracket goes further: no paid plans and no per-tournament pricing on the Organizer side, and when paid entry arrives (post-MVP) the fee on a ticket is the payment processor's own charge and nothing more — Stripe's fee when Stripe is used, no cobracket percentage on top — against start.gg's 6% and Tonamel's 5% + ¥100 per entry ([`docs/competitors.md`](./competitors.md)). The money goes from the participant to the Organizer's own payment account (Stripe Connect-style direct charges), so cobracket never holds it and the funds-settlement question falls on the processor rather than on cobracket (to be confirmed when payments are specified).
- **Revenue comes from spectators.** Ads on Spectator pages (Share Link, Event, and Ranking pages) and never on Organizer screens; or, in place of ads, payments from spectators themselves (an ad-free or supporter tier). The owner's reasoning for ads: most watching happens on streams, but people come back to a tournament page many times over an event, so these pages carry real traffic.
- **A share of what spectators bring in flows back to the discipline or Community it came from** — the owner's "funding pool", agreed in direction on 2026-10-22 with the structure not yet decided: ad revenue and spectator payments fund prizes or the running costs of tournaments in that discipline or Community. The constraints it is designed within: cobracket pays it out as its own sponsorship with a public ledger of where the money went, rather than holding users' money for payout (funds-settlement regulation); participants' money never funds prizes (JeSU's manual reads prizes paid from entry fees as a gambling risk under Penal Code article 185); and publisher rules differ by discipline — Nintendo and Capcom forbid sponsors and cash prizes at community tournaments while Riot sets no caps — so the pool is a per-discipline setting: off for a discipline whose publisher forbids sponsors, because a tournament's venue or stream paid from cobracket's own revenue is a sponsor's money by any reading of those guidelines (and a supporter payment tied to a tournament could read as the online spectator fee Nintendo also bans), which covers much of the first audience; open where the publisher sets no caps. Details and sources: [`docs/competitors.md`](./competitors.md).
- An "entry fee" field may appear early to measure demand before payments exist.

## Project posture (current)

cobracket is a learning project first — a way to learn Solid 2.0 and Convex by building something real — and it is developed the way a real product would be: features land continuously, with the domain model, specs, ADRs, and gates of a product that intends to ship. That is the point of the exercise, not a contradiction. The consequences for planning:

- **Production is live for the owner's design review** (decided 2026-09-27). The deployment pipeline (ADR 0010) deploys every push to `main`, so design feedback is given against the real URL rather than a local dev server. The URL is not yet shared with real people.
- **Sharing it with real people is the owner's call, on the owner's timing** — when the feature set and the UI feel ready, which they judge as they build. It is not gated on a checklist in this document, and nobody else decides it.
- **No user testing, rehearsals, or dry runs before that decision.** Validation with real people starts only once the owner judges cobracket usable; until then the owner's own use of the product is the only review, and work is not sequenced around preparing for real use.
- Until then, production data is the owner's own test data and is treated as disposable: schema changes may clear it instead of migrating it, and pre-release dependency churn (ADR 0004) is absorbed as routine work.

## First milestone

Run one real community tournament (8–16 participants) end to end on cobracket alone. Personal connections may supply this tournament but are not counted on; self-hosting one counts. Reaching it presupposes the sharing decision above, so it is where the plan ends, not what it is organized around.

## Plan (current)

Re-sequenced 2026-09-27 by the owner: the project is a way to exercise Convex and Solid 2.0 on a real product, so feature work is the main line and anything whose only purpose is real use waits for the sharing decision.

1. **Feature work** — the main line. It continues from the roadmap candidates below, in whatever order the owner picks.
2. A **deliberate UI/UX overhaul** once the feature set has settled, before the sharing decision. The **mobile experience** (touch pan/zoom, fit-to-view, narrow layouts) lands as part of that overhaul, not piecemeal before it. The desktop UI raised no major issue in the owner's review on 2026-09-27.
3. **Go-live work, held until the sharing decision** — what only matters once real people use the URL:
   - **Share Link OGP images** (ADR 0007's static SVG renderer, served by a Worker in front of `/s/*` per ADR 0010) — the one URL dropped in a group chat should unfurl well.
   - Operational gaps that only real use surfaces. The foreseeable ones are done (stories 26–27, ADR 0011).

Done: **production deployment** (ADR 0010), live for the owner's design review since 2026-09-27.

**MCP (`mvp.md` stories 18–20) is at the owner's discretion** (ADR 0009): built when the owner wants to build it, with no trigger to wait for. The single operations API it depends on stays in force, so that choice stays open.

## Roadmap candidates after MVP

Rough order: account sign-in and Communities (the owners of everything an Organizer runs — ADR 0023, 0024; moved ahead on 2026-10-14 because every later rule depends on who owns an Event) → luma-style Event hosting with Tracks, registration, and — later, out of `docs/specs/events.md`'s scope — check-in (MCP-operable — the north-star loop starts here, and registration removes the name-typing pain) → Discord bot as the second chat surface, once the operations API covers Events → participant self-reporting → remaining format families → teams (ADR 0028–0030: Squads and the Community tree, team Entries, Follows — the Events line's last three slices in `docs/specs/events.md`) → Player pages and the claiming of past results by their Players → Rankings and Seasons (ADR 0025, 0026: manual first, then placement points, then ratings; feeding seeding; team Rankings, ADR 0030) → spectator-page ads → paid entry, paid straight to the Organizer's own payment account.

## Open questions

- **Claim verification**: how a Player's claim of an organizer-entered Participant record is verified, and how disputes are handled.

## Spec-stage checklist

Deferred deliberately — none of these threaten the domain model, but they must not be forgotten when the relevant spec is written:

- Walkover cascades: mid-tournament withdrawal or disqualification propagation rules
- Best-of-N match detail (per-game results) as an additive extension to the outcome-plus-score result
- Composite format modeling: whether group-stage-into-playoffs is one tournament with phases or chained tournaments
- Spectator-scale reads: a popular Share Link can have orders of magnitude more viewers than participants
- Day-of operation under poor venue connectivity (the stack is online-first)
- Match-call notifications for participants at large events
- Rendering and querying very large brackets: a major can exceed 2,000 participants — the core design target stays 8–64, but the schema must not hard-cap size
- Global read latency from a single-region Convex deployment
- Public read API / data export for communities (roadmap candidate)
