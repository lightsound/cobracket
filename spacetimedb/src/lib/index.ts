// The shared library behind the module's registration files
// (ADR 0031): identity resolution and the read gates the views are
// built on. Only this entry point is importable outside
// spacetimedb/src/lib/.
export { userIdFor } from "./binding";
export { ownedTournament, sharedTournamentBySlug } from "./reads";
export {
  compareById,
  compareByIdDesc,
  compareBySeed,
  matchRow,
  participantRow,
  sortedRows,
} from "./rows";
