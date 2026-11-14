import type { Identity } from "spacetimedb";
import type { Db } from "./binding";
import { userIdFor } from "./binding";

// Shared read helpers behind the views in share.ts and
// tournaments.ts. Both surfaces resolve their tournament through one
// of these two gates, so the access rules live in exactly one place —
// the successor of convex/share.ts's canViewShared and the model
// layer's owned-tournament loads. Each returns the tournament row
// plus its discipline's display name, or undefined.

// The Share Link gate (convex/share.ts): the slug is the bearer
// credential, and it opens only a published, non-private tournament.
// MVP behavior is unlisted-only, but the gate reads the visibility
// field from day one so a future mutation exposing it cannot leak by
// omission. Unknown slugs and not-yet-viewable tournaments both
// resolve to undefined, without confirming which. A tournament whose
// discipline row is missing is an invariant violation; the shared
// surface fails closed (returns undefined) rather than half-render.
// The slug probe is the tournament table's unique index — the
// index-probe shape procedural views are limited to (ADR 0031).
export function sharedTournamentBySlug(db: Db, slug: string) {
  const tournament = db.tournament.shareSlug.find(slug);
  if (tournament === null) {
    return undefined;
  }
  if (tournament.status.tag === "draft" || tournament.visibility.tag === "private") {
    return undefined;
  }
  const discipline = db.discipline.id.find(tournament.disciplineId);
  if (discipline === null) {
    return undefined;
  }
  return { tournament, disciplineName: discipline.name };
}

// The Organizer gate: the tournament with this id, only when the
// sender's bound app_user owns it. Unbound identities and other
// organizers resolve to undefined — routes addressed by id are not
// capabilities (ADR 0019).
export function ownedTournament(db: Db, sender: Identity, tournamentId: bigint) {
  const userId = userIdFor(db, sender);
  if (userId === undefined) {
    return undefined;
  }
  const tournament = db.tournament.id.find(tournamentId);
  if (tournament === null || tournament.userId !== userId) {
    return undefined;
  }
  const discipline = db.discipline.id.find(tournament.disciplineId);
  if (discipline === null) {
    return undefined;
  }
  return { tournament, disciplineName: discipline.name };
}
