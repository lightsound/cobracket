// The shared model behind the API modules in convex/ (ADR 0020). Only this
// entry point is importable outside convex/model/, and only from convex/.
export { getOrCreateDiscipline, normalizeDisciplineName } from "./disciplines";
export type { TournamentStatus } from "./guards";
export {
  PRE_LIVE,
  findOwnedTournament,
  requireOrganizer,
  requireOwnedMatch,
  requireOwnedParticipant,
  requireOwnedTournament,
  requireOwnedTournamentIn,
  requireStatus,
} from "./guards";
export {
  MAX_MATCHES,
  MAX_RESULTS,
  MAX_ROSTER_SIZE,
  requireName,
  requireRosterCapacity,
  takeAll,
} from "./limits";
export { invalidateBracket } from "./structure";
export type { ResultSide } from "./validators";
export {
  formatArgsValidator,
  formatValidator,
  organizerTournamentViewValidator,
  resultSideValidator,
  statusValidator,
  tournamentViewValidator,
} from "./validators";
export {
  buildTournamentView,
  castParticipantId,
  deriveOrThrow,
  loadBracket,
  loadResults,
  loadRoster,
  requireDiscipline,
  rethrowEngineError,
  toRecordedResults,
  withMatchIds,
} from "./views";
