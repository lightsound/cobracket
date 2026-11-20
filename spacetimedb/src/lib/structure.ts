import type { WritableDb } from "./binding";
import { MAX_MATCHES, takeAll } from "./limits";

export function invalidateBracket(db: WritableDb, tournamentId: bigint): void {
  const matchDocs = takeAll(db.match.tournamentId.filter(tournamentId), MAX_MATCHES, "matches");
  for (const doc of matchDocs) {
    db.match.id.delete(doc.id);
  }
}
