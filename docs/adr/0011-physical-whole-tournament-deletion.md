# Tournament deletion is physical and whole; cancellation is not a lifecycle state

The first operational gaps real use surfaces are a tournament created by mistake (a test run, a wrong name or format) and one called off before play. We close both with two Organizer capabilities on the operations API — `updateTournament` (name and Discipline in every status; Format pre-live only, dropping the generated bracket like a roster change) and `deleteTournament` — and we make deletion **physical and whole**: the tournament document goes together with its roster, bracket, and results, in every lifecycle status, and its Share Link reads as not found from then on. We deliberately add **no `cancelled` status**.

This is compatible with ADR 0005, which a reader might expect to forbid deleting results. That ADR governs what may be *derived from* results and how they may be *changed*: progression is never stored, corrections are the only way to alter a result, and nothing may keep an aggregate while discarding the results behind it. Deleting the tournament those results belong to is a different act — no derived value survives to drift from its source. The pre-live code already deletes physically (`removeParticipant`, `invalidateBracket`), so this extends the existing pattern rather than introducing a second retention model.

## Considered Options

- **Soft delete (a `deletedAt` field or a `deleted` status).** Keeps the rows and makes an undo cheap, but every read — the Share Link lookup by slug, the Organizer's list, every ownership check — must filter it, and anonymous sign-up means spam and test tournaments would accumulate forever. Rejected for now: switching later is additive (one field, one mutation, one filter per read), while carrying it from day one taxes every query for a benefit no MVP Organizer has asked for.
- **Delete only while no result exists; require cancellation afterwards.** Protects recorded results, but forces the `cancelled` status into existence to have any way of folding a live tournament — the very concept we are deferring — and still leaves the Organizer unable to remove a completed test run.
- **A `cancelled` lifecycle status.** A fifth state that every allow-list, badge, and page must learn, whose only distinct behavior is a Share Link that says "cancelled" instead of "not available". For a community tournament of 8–16 people the cancellation is announced in the group chat anyway, and mid-play abandonment is rare enough that "stays live with its results" is acceptable. Deferred, not rejected: it is an additive union member, and it acquires real meaning once Events exist (a cancelled Event still has a page).

## Consequences

- Deleting a completed tournament discards its results; that is the Organizer's stated intent, and no downstream consumer (Rankings) exists yet. When rankings arrive, this decision is revisited alongside the eligibility rules the vision already lists as open.
- The UI asks for confirmation in two steps and names what is lost; the operations API itself does not, so a future chat surface must carry its own confirmation.
- `getTournament` answers `null` rather than throwing for anything that is not the caller's tournament — malformed, missing, just deleted in another tab, or foreign — so a deletion never surfaces as an error to retry on a page still showing the tournament.
