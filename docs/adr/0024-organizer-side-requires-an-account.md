# The Organizer side requires an email account; anonymity is for Registrants only

Amended by [ADR 0028](./0028-teams-are-communities-with-squads.md) and [ADR 0029](./0029-entries-and-entrants-how-teams-register.md) (2026-10-15): participant-number rows no longer exist — the number is a derived code (ADR 0028) — and the holdings cap counts Entry and Entrant rows (ADR 0029).

ADR 0003 promised a tournament with zero sign-up, and ADR 0021 kept that promise where it was made — drafts and standalone tournaments stayed anonymous, and only publishing an Event required a reachable Organizer — at the price of two tiers on the Organizer side: a publish gate, a rule that the last reachable Organizer can neither drop their email nor leave, a merge that re-points tournaments, Events, bans, and participant numbers under a holdings cap, and an MCP rule that an anonymous Organizer attaches an email first. ADR 0023 then made the Organizer a member of a Community, a subject of permissions. A permission subject that may be unreachable adds an "if reachable" branch to every rule about members, invitations, and hand-overs. The owner asked on 2026-10-14 whether requiring an email for Event creation would be simpler, and decided it is.

**Everything on the Organizer side requires an account with a verified email: creating or operating a tournament, an Event, or a Community, and holding any membership or Grant that confers an Organizer capability.** One sentence states the rule: the subject of a permission is always a reachable account; anonymity exists only on the Registrant side — registering on an anonymous-allowed Track (a one-player one, since 2026-10-22, ADR 0029), and a one-player Track's claim links — exactly as ADR 0013 and 0015 already bound it. The sign-in is ADR 0021's email code, about twenty seconds, and every tournament tool compared during the grilling (Luma, start.gg, Challonge) asks for an account before creating anything, so the expectation exists.

What this dissolves: the publish gate and its sign-in inside the publish flow; the reachable-member invariants; the merge's Organizer half — an anonymous identity now holds only Entries, their `players` link, and the participant-number rows other Communities assigned it, so the merge preview lists Entries and bans on the person and nothing else, and the holdings cap counts Entries and number rows alone; ADR 0022's anonymous-Organizer deletion path; the MCP first-attach-an-email sentence; and the anti-spam problem of anonymous tournament and Event creation, which becomes the per-address and per-account code limits ADR 0021 already set plus per-account creation limits, set by [ADR 0027](./0027-abuse-limits-where-things-reach-others.md).

What it reverses: ADR 0003's zero-friction start and the second differentiator in `docs/vision.md`, story 25 of `docs/specs/mvp.md` (an anonymous identity that persists in the browser), and ADR 0021's "drafts and standalone tournaments stay anonymous" together with its rejection of requiring sign-in to create. That rejection's reason — a draft affects nobody, so friction there protects nobody — still holds; what changed is the question. The cost of the two tiers was never the draft but the branching every later rule needed, and the Community model multiplied the branches.

## Considered Options

- **Keep the two tiers** (anonymous creation, email at publication). Every Community rule gains a reachability branch, and Q8 of the grilling (may an anonymous identity create or join a named Community) needed an answer of its own.
- **Require the email only to create or join a Community.** Still two tiers, since every person's first Community is created with their account.
- **Take the email at creation but verify it later.** An unverified account is the worst of both: a subject that looks reachable and is not.
- **Require the account where something becomes visible to others** (issuing a Share Link). The MVP's anonymous Share Links contradict it, and it is the publish gate under another name.
- **Social sign-in to lower the friction.** Rejected in ADR 0021; a verified email from Google or Discord can be added behind the same entry point later.

## Consequences

- `docs/specs/events.md`: account sign-in (ADR 0021, 0022) becomes slice 1 and Communities (ADR 0023) slice 2, ahead of Events; the former slice numbers shift. Resend's sending domain must be verified before slice 1 — the owner's own step.
- `getOrganizer` in `convex/auth.ts` answers an Organizer capability only for an account with a verified email; an anonymous identity is a Registrant identity. The MVP's web UI starts with sign-in, on the production design-review URL too, and the anonymous tournaments in production are cleared with the schema change (AGENTS.md: no users, no migrations).
- `docs/vision.md`'s second differentiator becomes "a tournament in a minute: one email code, no password, no profile"; ADR 0003's anonymous sign-in remains the Registrant-side identity and the seam it describes stands.
- ADR 0021's publish gate and reachable-Organizer rules, ADR 0022's Organizer side, the holdings cap, the merge preview, and the MCP token rule are amended in place.
