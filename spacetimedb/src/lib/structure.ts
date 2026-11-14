import type { WritableDb } from "./binding";
import { MAX_MATCHES, takeAll } from "./limits";

// A structural roster or seeding change makes the generated bracket
// stale (structure is fixed at generation), so it is dropped and must
// be regenerated. Safe pre-live: no results exist yet, so nothing is
// orphaned. The successor of convex/model/structure.ts.
export function invalidateBracket(db: WritableDb, tournamentId: bigint): void {
  const matchDocs = takeAll(db.match.tournamentId.filter(tournamentId), MAX_MATCHES, "matches");
  for (const doc of matchDocs) {
    db.match.id.delete(doc.id);
  }
}
