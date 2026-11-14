// The shared library behind the module's registration files
// (ADR 0031): identity resolution, guards, loaders, and the read
// gates the views are built on. Only this entry point is importable
// outside spacetimedb/src/lib/.
export type { TournamentStatusTag, WritableDb } from "./binding";
export { organizerIdFor, requireBoundUser, resolveSession } from "./binding";
/**
 * The db-to-engine converters and the argument-format type are the
 * vocabulary of the read composition — views plus engine — that the
 * module's test package performs in spacetimedb/test/compose.ts, the
 * same composition the client performs from M3. Tagged @public for
 * that one cross-package consumer.
 *
 * @public
 */
export type { DbSide } from "./convert";
/**
 * See the DbSide tag above: the converters the read composition
 * applies to view rows.
 *
 * @public
 */
export { formatToEngine, sideToEngine, slotToEngine } from "./convert";
export { formatToStored, sameFormat, slotToDb } from "./convert";
export { getOrCreateDiscipline, normalizeDisciplineName } from "./disciplines";
export {
  PRE_LIVE,
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
export {
  deriveOrThrow,
  generateOrThrow,
  loadBracket,
  loadResults,
  loadRoster,
  toRecordedResults,
} from "./loaders";
export { ownedTournament, sharedTournamentBySlug } from "./reads";
export {
  compareById,
  compareByIdDesc,
  compareBySeed,
  matchRow,
  participantRow,
  sortedRows,
} from "./rows";
export { invalidateBracket } from "./structure";
/**
 * The reducer argument format's type, for the test package's call
 * sites — same @public rationale as the converters above.
 *
 * @public
 */
export type { FormatArg } from "./validators";
export { formatArg } from "./validators";
