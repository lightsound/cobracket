import { deriveProgression } from "../../spacetimedb/format";
import type {
  BracketStructure,
  Progression,
  RecordedResult,
  ResultSide as EngineSide,
  SlotSource as EngineSlot,
} from "../../spacetimedb/format";
import type {
  CurrentOrganizerRow,
  DisciplineSuggestionRow,
  MyTournamentRow,
  OrganizerMatchRow,
  OrganizerParticipantRow,
  OrganizerResultRow,
  OrganizerTournamentRow,
  SessionStateRow,
  SharedMatchRow,
  SharedParticipantRow,
  SharedResultRow,
  SharedTournamentRow,
  SlotSource as BindingSlot,
  ResultSide as BindingSide,
  TournamentFormat as BindingFormat,
} from "../../spacetimedb/bindings/types";
import type {
  CreateTournamentArgs,
  Format,
  FormatArg,
  MatchView,
  OccupantView,
  OrganizerTournamentView,
  Outcome,
  ParticipantView,
  ProgressionView,
  ReportResult,
  ResultSideInput,
  TournamentSummary,
  TournamentView,
  UpdateTournamentArgs,
} from "./operations";

// The SpacetimeDB adapter's pure layer: everything that turns the
// generated bindings' rows into the seam's contract shapes
// (`./operations`), turns contract write arguments into reducer
// arguments, and — the migration's error channel — decides, before a
// write is sent, whether the module would refuse it and with what
// message. No connection, no reactivity: the adapter (`./spacetimedb`)
// feeds this layer snapshots of what its subscriptions currently
// hold, and the unit tests feed it fixtures.
//
// Why pre-validation exists: on Convex a refused mutation delivers
// the guard's own text ("Tournament not found", "Cannot publish: …")
// and the pages print it — that text is the failure contract. On
// SpacetimeDB 2.15 a reducer's throw does not cross the wire: every
// refusal arrives as an opaque InternalError ("The instance
// encountered a fatal error."), measured in the connection suite
// (spacetimedb/connection/gating.test.ts). The module's guards are
// functions of state the client already holds through its
// subscriptions (the tournament's status and format, the roster, the
// bracket, the recorded results) plus the write's own arguments, so
// the adapter mirrors the guards here — same checks, same order,
// same texts (the module's lib/guards.ts, lib/limits.ts and the
// reducers are the source; M2 ported the texts verbatim from Convex,
// and this layer is their third copy by necessity, pinned by the
// tests in ./spacetimedb.test.ts). The reducer stays the authority:
// it re-checks everything server-side, and anything this layer
// cannot decide (a tournament the client holds no state for, a race
// against another tab) goes to the reducer, whose refusal then
// surfaces as the one generic message in `./spacetimedb`.

// ---------------------------------------------------------------------------
// Bounds and texts, mirrored from spacetimedb/src/lib/limits.ts
// ---------------------------------------------------------------------------

const MAX_NAME_LENGTH = 120;
const MAX_ROSTER_SIZE = 128;
const MAX_RESULTS = 4 * (2 * MAX_ROSTER_SIZE);

/** The write refusal a pre-validation decided, worded as the module words it. */
export type Refusal = string;

function requireName(raw: string, label: string): Refusal | null {
  const name = raw.trim();
  if (name === "") return `${label} must not be empty`;
  if (name.length > MAX_NAME_LENGTH) {
    return `${label} must be at most ${MAX_NAME_LENGTH} characters`;
  }
  return null;
}

/** The trimmed, collapsed display form (spacetimedb/src/lib/disciplines.ts). */
export function normalizeDisciplineName(raw: string): { name: string; normalizedName: string } {
  const name = raw.trim().replace(/\s+/g, " ");
  return { name, normalizedName: name.toLowerCase() };
}

// ---------------------------------------------------------------------------
// Bindings rows -> contract shapes
// ---------------------------------------------------------------------------

type BindingSeeding = OrganizerTournamentRow["seeding"];

export function statusToContract(status: MyTournamentRow["status"]): TournamentSummary["status"] {
  return (status.tag.charAt(0).toLowerCase() + status.tag.slice(1)) as TournamentSummary["status"];
}

export function formatToContract(format: BindingFormat): Format {
  return format.tag === "SingleElimination"
    ? { family: "single_elimination" }
    : { family: "double_elimination", grandFinalReset: format.value.grandFinalReset };
}

function seedingToContract(seeding: BindingSeeding): "random" | "manual" {
  return seeding.tag === "Manual" ? "manual" : "random";
}

const OUTCOME_TO_CONTRACT: Record<BindingSide["outcome"]["tag"], Outcome> = {
  Win: "win",
  Loss: "loss",
  Draw: "draw",
  Walkover: "walkover",
  Disqualification: "disqualification",
};

export const OUTCOME_TO_BINDING: Record<Outcome, BindingSide["outcome"]["tag"]> = {
  win: "Win",
  loss: "Loss",
  draw: "Draw",
  walkover: "Walkover",
  disqualification: "Disqualification",
};

function slotToEngine(slot: BindingSlot): EngineSlot {
  if (slot.tag === "Bye") return { kind: "bye" };
  if (slot.tag === "Participant") {
    return { kind: "participant", participantId: String(slot.value.participantId) };
  }
  return {
    kind: slot.tag === "WinnerOf" ? "winnerOf" : "loserOf",
    matchKey: slot.value.matchKey,
  };
}

function sideToEngine(side: BindingSide): EngineSide {
  return {
    participantId: String(side.participantId),
    outcome: OUTCOME_TO_CONTRACT[side.outcome.tag],
    ...(side.score !== undefined && { score: side.score }),
  };
}

// ---------------------------------------------------------------------------
// Read compositions
// ---------------------------------------------------------------------------

export function composeMyTournaments(rows: readonly MyTournamentRow[]): TournamentSummary[] {
  return [...rows]
    .sort((a, b) =>
      a.tournamentId < b.tournamentId ? 1 : a.tournamentId > b.tournamentId ? -1 : 0,
    )
    .map((row) => ({
      tournamentId: String(row.tournamentId),
      name: row.name,
      status: statusToContract(row.status),
      format: formatToContract(row.format),
      discipline: row.discipline,
      shareSlug: row.shareSlug,
    }));
}

export function composeCurrentOrganizer(row: CurrentOrganizerRow | undefined): string | null {
  return row === undefined ? null : String(row.userId);
}

/** The caller's session as the module's session_state view reports it. */
export type SessionState =
  | { kind: "unauthenticated" }
  | { kind: "user_missing" }
  | { kind: "organizer"; userId: string };

export function composeSessionState(row: SessionStateRow | undefined): SessionState {
  if (row === undefined) return { kind: "unauthenticated" };
  switch (row.state.tag) {
    case "Unauthenticated":
      return { kind: "unauthenticated" };
    case "UserMissing":
      return { kind: "user_missing" };
    case "Organizer":
      return { kind: "organizer", userId: String(row.state.value.userId) };
  }
}

/**
 * The suggest_disciplines view's answer for one prefix, reproduced
 * from whatever rows the connection's merged cache currently holds:
 * argument-view caches merge across a connection's subscriptions, so
 * the cache can hold a wider prefix's rows beside this one's, and the
 * view's own rule (normalized prefix match with the U+FFFF exclusion,
 * normalized order, first ten — spacetimedb/src/disciplines.ts) is a
 * pure function of the rows, so applying it here is exact for any
 * superset the cache delivers.
 */
export function filterSuggestions(
  rows: readonly DisciplineSuggestionRow[],
  prefix: string,
): string[] {
  const { normalizedName } = normalizeDisciplineName(prefix);
  if (normalizedName === "") return [];
  const seen = new Set<string>();
  return rows
    .map((row) => ({
      name: row.name,
      normalized: normalizeDisciplineName(row.name).normalizedName,
    }))
    .filter(
      (entry) =>
        entry.normalized.startsWith(normalizedName) &&
        !entry.normalized.startsWith(`${normalizedName}\uffff`),
    )
    .sort((a, b) => (a.normalized < b.normalized ? -1 : a.normalized > b.normalized ? 1 : 0))
    .filter((entry) => {
      if (seen.has(entry.name)) return false;
      seen.add(entry.name);
      return true;
    })
    .slice(0, 10)
    .map((entry) => entry.name);
}

// The bracket half of a tournament composition: structure + recorded
// results in, the contract's progression out. Mirrors the module
// harness's composition (spacetimedb/test/compose.ts), with the
// contract's string ids throughout. `recordedMatchIds` runs parallel
// to the recorded results on the Organizer surface (its results are
// keyed by match row id); the shared surface keys results by match
// key directly and passes undefined.
interface BracketInputs<MatchRow extends { round: number; indexInRound: number }> {
  format: Format;
  matches: readonly MatchRow[];
  matchKeyOf: (match: MatchRow) => string;
  slotsOf: (match: MatchRow) => readonly BindingSlot[];
  bracketOf: (match: MatchRow) => "winners" | "losers" | "grand_final";
  recorded: readonly RecordedResult[];
}

function progressionOf<MatchRow extends { round: number; indexInRound: number }>(
  inputs: BracketInputs<MatchRow>,
): { progression: Progression; structure: BracketStructure } {
  const structure: BracketStructure = {
    format: inputs.format,
    matches: inputs.matches.map((match) => ({
      key: inputs.matchKeyOf(match),
      bracket: inputs.bracketOf(match),
      round: match.round,
      indexInRound: match.indexInRound,
      slots: [slotToEngine(inputs.slotsOf(match)[0]!), slotToEngine(inputs.slotsOf(match)[1]!)],
    })),
  };
  return { progression: deriveProgression(structure, inputs.recorded), structure };
}

function bracketView<Match extends MatchView>(
  hasStructure: boolean,
  progression: Progression,
  recorded: readonly RecordedResult[],
  matchView: (derived: Progression["matches"][number]) => Match,
): ProgressionView<Match> | null {
  if (!hasStructure) {
    // No structure was ever generated: the contract's null bracket
    // (the surface's own rule, as in spacetimedb/test/compose.ts).
    return null;
  }
  return {
    matches: progression.matches.map(matchView),
    readyMatchKeys: progression.readyMatchKeys,
    completed: progression.completed,
    ...(progression.championId !== undefined && { championId: progression.championId }),
    standings: progression.standings,
    voidedMatchKeys: progression.voidedResultIndices.map((index) => recorded[index]!.matchKey),
  };
}

/** The roster in contract shape, by seed — the same on both tournament surfaces. */
function participantsView(
  rows: readonly { participantId: bigint; name: string; seed: number }[],
): ParticipantView[] {
  return [...rows]
    .sort((a, b) => a.seed - b.seed)
    .map((row) => ({
      participantId: String(row.participantId),
      name: row.name,
      seed: row.seed,
    }));
}

function bracketSectionOf(
  tag: "Winners" | "Losers" | "GrandFinal",
): "winners" | "losers" | "grand_final" {
  return tag === "Winners" ? "winners" : tag === "Losers" ? "losers" : "grand_final";
}

/**
 * Structure + recorded results in, the contract bracket out, with
 * the engine's own outputs alongside (the Organizer surface's
 * knowledge is built from them).
 */
function composeBracket<
  MatchRow extends { key: string; round: number; indexInRound: number },
  Match extends MatchView,
>(
  format: Format,
  matches: readonly MatchRow[],
  slotsOf: (match: MatchRow) => readonly BindingSlot[],
  bracketOf: (match: MatchRow) => "winners" | "losers" | "grand_final",
  recorded: readonly RecordedResult[],
  matchView: (derived: Progression["matches"][number]) => Match,
): {
  bracket: ProgressionView<Match> | null;
  progression: Progression;
  structure: BracketStructure;
} {
  const { progression, structure } = progressionOf({
    format,
    matches,
    matchKeyOf: (match) => match.key,
    slotsOf,
    bracketOf,
    recorded,
  });
  return {
    bracket: bracketView(matches.length > 0, progression, recorded, matchView),
    progression,
    structure,
  };
}

function derivedMatchView(
  derived: Progression["matches"][number],
  recorded: readonly RecordedResult[],
): MatchView {
  return {
    key: derived.key,
    bracket: derived.bracket,
    round: derived.round,
    indexInRound: derived.indexInRound,
    state: derived.state,
    occupants: derived.occupants.map((occupant): OccupantView =>
      occupant.kind === "participant"
        ? { kind: "participant", participantId: occupant.participantId }
        : occupant,
    ),
    ...(derived.winnerId !== undefined && { winnerId: derived.winnerId }),
    ...(derived.loserId !== undefined && { loserId: derived.loserId }),
    ...(derived.resultIndex !== undefined && {
      sides: recorded[derived.resultIndex]!.sides.map((side) => ({ ...side })),
    }),
  };
}

export interface OrganizerRows {
  header: OrganizerTournamentRow | undefined;
  participants: readonly OrganizerParticipantRow[];
  matches: readonly OrganizerMatchRow[];
  results: readonly OrganizerResultRow[];
}

/**
 * Everything the write paths need to know about one tournament, kept
 * beside the composition: the engine inputs (so reportResult's
 * candidate can be derived locally, exactly as the reducer derives
 * it) and the per-record voided set (so a later write's return can
 * name what it voided).
 */
export interface TournamentKnowledge {
  status: TournamentSummary["status"];
  format: Format;
  participants: ParticipantView[];
  matchCount: number;
  resultCount: number;
  structure: BracketStructure;
  recorded: RecordedResult[];
  /** Parallel to `recorded`: the Organizer surface's match row ids, as strings. */
  recordedMatchIds: string[];
  /** Match row id (string) -> structural key, for every match in the structure. */
  matchKeyById: ReadonlyMap<string, string>;
  /** The voided records' result row ids, as strings (per-record granularity). */
  voidedResultIds: ReadonlySet<string>;
  /** Parallel to `recorded`: each record's result row id, as a string. */
  recordedResultIds: string[];
}

export interface OrganizerComposition {
  view: OrganizerTournamentView | null;
  knowledge: TournamentKnowledge | null;
}

export function composeOrganizerTournament(rows: OrganizerRows): OrganizerComposition {
  const { header } = rows;
  if (header === undefined) return { view: null, knowledge: null };
  const format = formatToContract(header.format);
  const participants = participantsView(rows.participants);
  const matches = [...rows.matches].sort((a, b) =>
    a.matchId < b.matchId ? -1 : a.matchId > b.matchId ? 1 : 0,
  );
  const results = [...rows.results].sort((a, b) =>
    a.resultId < b.resultId ? -1 : a.resultId > b.resultId ? 1 : 0,
  );
  const matchKeyById = new Map(matches.map((match) => [String(match.matchId), match.key]));
  const recorded: RecordedResult[] = results.map((result) => ({
    matchKey: matchKeyById.get(String(result.matchId))!,
    sides: [sideToEngine(result.sides[0]!), sideToEngine(result.sides[1]!)],
  }));
  const matchIdByKey = new Map(matches.map((match) => [match.key, String(match.matchId)]));
  const { bracket, progression, structure } = composeBracket(
    format,
    matches,
    (match) => match.slots,
    (match) => bracketSectionOf(match.bracket.tag),
    recorded,
    (derived) => ({
      ...derivedMatchView(derived, recorded),
      matchId: matchIdByKey.get(derived.key)!,
    }),
  );
  const view: OrganizerTournamentView = {
    tournamentId: String(header.tournamentId),
    name: header.name,
    status: statusToContract(header.status),
    format,
    discipline: header.discipline,
    shareSlug: header.shareSlug,
    seeding: seedingToContract(header.seeding),
    participants,
    bracket,
  };
  const knowledge: TournamentKnowledge = {
    status: view.status,
    format,
    participants,
    matchCount: matches.length,
    resultCount: results.length,
    structure,
    recorded,
    recordedMatchIds: results.map((result) => String(result.matchId)),
    matchKeyById,
    voidedResultIds: new Set(
      progression.voidedResultIndices.map((index) => String(results[index]!.resultId)),
    ),
    recordedResultIds: results.map((result) => String(result.resultId)),
  };
  return { view, knowledge };
}

export interface SharedRows {
  header: SharedTournamentRow | undefined;
  participants: readonly SharedParticipantRow[];
  matches: readonly SharedMatchRow[];
  results: readonly SharedResultRow[];
}

export function composeSharedTournament(rows: SharedRows): TournamentView | null {
  const { header } = rows;
  if (header === undefined) return null;
  const format = formatToContract(header.format);
  const participants = participantsView(rows.participants);
  // Shared matches carry no row id; their order is the structure's
  // own (section, then round, then position) — the order the module
  // inserted them in, which the Organizer surface gets from row ids.
  const sectionRank = { Winners: 0, Losers: 1, GrandFinal: 2 } as const;
  const matches = [...rows.matches].sort(
    (a, b) =>
      sectionRank[a.bracket.tag] - sectionRank[b.bracket.tag] ||
      a.round - b.round ||
      a.indexInRound - b.indexInRound,
  );
  const results = [...rows.results].sort((a, b) => (a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0));
  const recorded: RecordedResult[] = results.map((result) => ({
    matchKey: result.matchKey,
    sides: [sideToEngine(result.sides[0]!), sideToEngine(result.sides[1]!)],
  }));
  const { bracket } = composeBracket(
    format,
    matches,
    (match) => match.slots,
    (match) => bracketSectionOf(match.bracket.tag),
    recorded,
    (derived) => derivedMatchView(derived, recorded),
  );
  return {
    name: header.name,
    status: statusToContract(header.status),
    format,
    discipline: header.discipline,
    participants,
    bracket,
  };
}

// ---------------------------------------------------------------------------
// Contract write arguments -> reducer arguments
// ---------------------------------------------------------------------------

export function formatArgToBinding(format: FormatArg): BindingFormat {
  return format.family === "single_elimination"
    ? { tag: "SingleElimination" }
    : {
        tag: "DoubleElimination",
        value: { grandFinalReset: format.grandFinalReset ?? true },
      };
}

/** The stored-format form of a format argument (defaults applied, as the module applies them). */
function formatArgEffective(format: FormatArg): Format {
  return formatToContract(formatArgToBinding(format));
}

function formatKey(format: Format): string {
  return format.family === "single_elimination"
    ? "single_elimination"
    : `double_elimination:${format.grandFinalReset}`;
}

function sameFormat(a: Format, b: Format): boolean {
  return formatKey(a) === formatKey(b);
}

export interface ReportResultArgs {
  matchId: string;
  sides: ResultSideInput[];
}

// ---------------------------------------------------------------------------
// Pre-validation: the module's guards, mirrored (see the header)
// ---------------------------------------------------------------------------

/**
 * What the adapter currently knows, in the model's terms: the
 * session resolution (from its always-held session_state feed) and
 * the latest composed knowledge per tournament it holds a scope for.
 * Checks that need state the adapter does not hold are skipped — the
 * reducer decides those — except the pure argument checks, which
 * always run. Within what is checked, the order is the module's.
 */
export interface KnownState {
  session: SessionState | "unknown";
  tournaments: ReadonlyMap<string, TournamentKnowledge>;
  /** participantId (string) -> tournamentId (string), over held scopes. */
  participantHome: ReadonlyMap<string, string>;
  /** matchId (string) -> tournamentId (string), over held scopes. */
  matchHome: ReadonlyMap<string, string>;
}

const PRE_LIVE: readonly string[] = ["draft", "published"];

function statusRefusal(
  knowledge: TournamentKnowledge,
  allowed: readonly string[],
  operation: string,
): Refusal | null {
  return allowed.includes(knowledge.status)
    ? null
    : `Cannot ${operation}: the tournament is ${knowledge.status}`;
}

function sessionRefusal(state: KnownState): Refusal | null {
  // requireBoundUser binds an unbound identity on first use, so an
  // unauthenticated caller is never refused; a binding whose user
  // row is gone is refused with this text and nothing else is.
  return state.session !== "unknown" && state.session.kind === "user_missing"
    ? "Not signed in"
    : null;
}

function rosterRefusal(knowledge: TournamentKnowledge, operation: string): Refusal | null {
  return statusRefusal(knowledge, PRE_LIVE, operation);
}

/**
 * Decide a write's refusal before it is sent, or null to send it.
 * `op` is the descriptor's SpacetimeDB write key; `args` are the
 * contract arguments (ids as strings). Mirrors, per operation, the
 * guard sequence of spacetimedb/src/{tournaments,roster,bracket}.ts.
 */
export function validateWrite(
  op: string,
  args: Record<string, unknown>,
  state: KnownState,
): Refusal | null {
  const session = sessionRefusal(state);
  if (session !== null) return session;
  switch (op) {
    case "createTournament":
      return validateCreate(args);
    case "updateTournament":
      return validateUpdate(args, state);
    case "deleteTournament":
      // Ownership and existence are the reducer's to decide (see the
      // header on what is not decidable client-side).
      return null;
    case "addParticipant":
      return validateAddParticipant(args, state);
    case "addParticipants":
      return validateAddParticipants(args, state);
    case "renameParticipant":
      return validateRenameParticipant(args, state);
    case "removeParticipant":
      return validateRemoveParticipant(args, state);
    case "reorderSeeding":
      return validateReorderSeeding(args, state);
    case "generateBracket":
      return validateGenerateBracket(args, state);
    case "publishTournament":
      return validatePublishTournament(args, state);
    case "reportResult":
      return validateReportResult(args, state);
    default:
      return null;
  }
}

function tournamentOf(state: KnownState, id: unknown): TournamentKnowledge | undefined {
  return typeof id === "string" ? state.tournaments.get(id) : undefined;
}

function homeKnowledge(
  state: KnownState,
  home: ReadonlyMap<string, string>,
  id: string,
): TournamentKnowledge | undefined {
  const tournamentId = home.get(id);
  return tournamentId !== undefined ? state.tournaments.get(tournamentId) : undefined;
}

function validateCreate(args: Record<string, unknown>): Refusal | null {
  const a = args as unknown as CreateTournamentArgs;
  return (
    requireName(a.name, "Tournament name") ??
    requireName(normalizeDisciplineName(a.discipline).name, "Discipline")
  );
}

function validateUpdate(args: Record<string, unknown>, state: KnownState): Refusal | null {
  const a = args as unknown as UpdateTournamentArgs;
  if (a.name !== undefined) {
    const refusal = requireName(a.name, "Tournament name");
    if (refusal !== null) return refusal;
  }
  if (a.discipline !== undefined) {
    const refusal = requireName(normalizeDisciplineName(a.discipline).name, "Discipline");
    if (refusal !== null) return refusal;
  }
  if (a.format !== undefined) {
    const knowledge = tournamentOf(state, a.tournamentId);
    if (knowledge !== undefined && !sameFormat(formatArgEffective(a.format), knowledge.format)) {
      return statusRefusal(knowledge, PRE_LIVE, "change the format");
    }
  }
  return null;
}

function validateAddParticipant(args: Record<string, unknown>, state: KnownState): Refusal | null {
  const a = args as { tournamentId: string; name: string };
  const knowledge = tournamentOf(state, a.tournamentId);
  if (knowledge !== undefined) {
    const refusal = rosterRefusal(knowledge, "edit the roster");
    if (refusal !== null) return refusal;
    if (knowledge.participants.length + 1 > MAX_ROSTER_SIZE) {
      return `A tournament can have at most ${MAX_ROSTER_SIZE} participants`;
    }
  }
  return requireName(a.name, "Participant name");
}

function validateAddParticipants(args: Record<string, unknown>, state: KnownState): Refusal | null {
  const a = args as { tournamentId: string; text: string };
  const knowledge = tournamentOf(state, a.tournamentId);
  if (knowledge !== undefined) {
    const refusal = rosterRefusal(knowledge, "edit the roster");
    if (refusal !== null) return refusal;
  }
  const names = parseBulkNames(a.text);
  if (names.length === 0) return "No participant names given";
  if (knowledge !== undefined && knowledge.participants.length + names.length > MAX_ROSTER_SIZE) {
    return `A tournament can have at most ${MAX_ROSTER_SIZE} participants`;
  }
  for (const name of names) {
    const refusal = requireName(name, "Participant name");
    if (refusal !== null) return refusal;
  }
  return null;
}

function validateRenameParticipant(
  args: Record<string, unknown>,
  state: KnownState,
): Refusal | null {
  const a = args as { participantId: string; name: string };
  const knowledge = homeKnowledge(state, state.participantHome, a.participantId);
  if (knowledge !== undefined) {
    const refusal = rosterRefusal(knowledge, "edit the roster");
    if (refusal !== null) return refusal;
  }
  return requireName(a.name, "Participant name");
}

function validateRemoveParticipant(
  args: Record<string, unknown>,
  state: KnownState,
): Refusal | null {
  const a = args as { participantId: string };
  const knowledge = homeKnowledge(state, state.participantHome, a.participantId);
  if (knowledge !== undefined) {
    return rosterRefusal(knowledge, "edit the roster");
  }
  return null;
}

function validateReorderSeeding(args: Record<string, unknown>, state: KnownState): Refusal | null {
  const a = args as { tournamentId: string; orderedParticipantIds: string[] };
  const knowledge = tournamentOf(state, a.tournamentId);
  if (knowledge === undefined) return null;
  const refusal = statusRefusal(knowledge, PRE_LIVE, "reorder the seeding");
  if (refusal !== null) return refusal;
  const rosterIds = new Set(knowledge.participants.map((p) => p.participantId));
  const orderedIds = new Set(a.orderedParticipantIds);
  if (
    a.orderedParticipantIds.length !== knowledge.participants.length ||
    orderedIds.size !== rosterIds.size ||
    [...orderedIds].some((id) => !rosterIds.has(id))
  ) {
    return "The new order must contain every participant exactly once";
  }
  return null;
}

function validateGenerateBracket(args: Record<string, unknown>, state: KnownState): Refusal | null {
  const a = args as { tournamentId: string };
  const knowledge = tournamentOf(state, a.tournamentId);
  if (knowledge === undefined) return null;
  const refusal = statusRefusal(knowledge, PRE_LIVE, "generate the bracket");
  if (refusal !== null) return refusal;
  return knowledge.participants.length < 2
    ? "At least two participants are required to generate a bracket"
    : null;
}

function validatePublishTournament(
  args: Record<string, unknown>,
  state: KnownState,
): Refusal | null {
  const a = args as { tournamentId: string };
  const knowledge = tournamentOf(state, a.tournamentId);
  if (knowledge === undefined) return null;
  const refusal = statusRefusal(knowledge, ["draft"], "publish");
  if (refusal !== null) return refusal;
  return knowledge.matchCount === 0 ? "Generate the bracket before publishing" : null;
}

function validateReportResult(args: Record<string, unknown>, state: KnownState): Refusal | null {
  const a = args as unknown as ReportResultArgs;
  const knowledge = homeKnowledge(state, state.matchHome, a.matchId);
  if (knowledge !== undefined) {
    const refusal = statusRefusal(knowledge, ["published", "live", "completed"], "report a result");
    if (refusal !== null) return refusal;
  }
  if (a.sides.length !== 2) return "A result must have exactly two sides";
  for (const side of a.sides) {
    if (side.score !== undefined && !Number.isFinite(side.score)) {
      return "A score must be a finite number";
    }
  }
  if (knowledge === undefined) return null;
  return deriveCandidateRefusal(knowledge, a);
}

function candidateResult(matchKey: string, a: ReportResultArgs): RecordedResult {
  const side = (input: ResultSideInput): RecordedResult["sides"][number] => ({
    participantId: input.participantId,
    outcome: input.outcome,
    ...(input.score !== undefined && { score: input.score }),
  });
  return { matchKey, sides: [side(a.sides[0]!), side(a.sides[1]!)] };
}

function deriveCandidateRefusal(
  knowledge: TournamentKnowledge,
  a: ReportResultArgs,
): Refusal | null {
  if (knowledge.resultCount >= MAX_RESULTS) {
    return `A tournament can record at most ${MAX_RESULTS} results`;
  }
  const matchKey = knowledge.matchKeyById.get(a.matchId);
  if (matchKey === undefined) return null;
  const recorded = [...knowledge.recorded, candidateResult(matchKey, a)];
  let progression: Progression;
  try {
    progression = deriveProgression(knowledge.structure, recorded);
  } catch (error) {
    // The module surfaces the engine's own message for a
    // derivation refusal (its loaders rethrow it), as did Convex.
    return error instanceof Error ? error.message : String(error);
  }
  if (progression.voidedResultIndices.includes(recorded.length - 1)) {
    return "This result does not apply to the match's current participants";
  }
  if (knowledge.status === "completed" && !progression.completed) {
    return "Cannot correct: this would reopen a completed tournament";
  }
  return null;
}

/** The bulk-entry parse, mirrored from the roster reducer (and Convex before it). */
export function parseBulkNames(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

// ---------------------------------------------------------------------------
// Write-result synthesis: the returns reducers do not have
// ---------------------------------------------------------------------------

/**
 * createTournament's return, from the my_tournaments rows that
 * appeared across the call: the created row is the newest one that
 * matches the submitted name, discipline, and format. (A concurrent
 * create from another tab of the same identity can add a second
 * matching row in the same window; the newest is the best answer
 * available — the Convex return had no such ambiguity.)
 */
export function synthesizeCreated(
  beforeIds: ReadonlySet<string>,
  after: readonly TournamentSummary[],
  args: CreateTournamentArgs,
): { tournamentId: string; shareSlug: string } | null {
  const discipline = normalizeDisciplineName(args.discipline).name;
  const format = formatArgEffective(args.format);
  const fresh = after.filter(
    (row) =>
      !beforeIds.has(row.tournamentId) &&
      row.name === args.name.trim() &&
      row.discipline === discipline &&
      sameFormat(row.format, format),
  );
  const picked = fresh[0];
  return picked === undefined
    ? null
    : { tournamentId: picked.tournamentId, shareSlug: picked.shareSlug };
}

/**
 * addParticipants' return: the inserted rows form a contiguous seed
 * run whose names are the submitted ones in order (a batch inserts
 * in one transaction); find that run among the rows that appeared
 * across the call. No matching run yet means an empty answer, not a
 * guess.
 */
export function synthesizeAddedParticipants(
  beforeIds: ReadonlySet<string>,
  after: readonly ParticipantView[],
  names: readonly string[],
): string[] {
  const fresh = after.filter((row) => !beforeIds.has(row.participantId));
  const bySeed = [...fresh].sort((a, b) => a.seed - b.seed);
  for (let start = 0; start + names.length <= bySeed.length; start++) {
    const run = bySeed.slice(start, start + names.length);
    if (run.every((row, index) => row.name === names[index]!.trim())) {
      return run.map((row) => row.participantId);
    }
  }
  // No matching run: this call's rows have not been delivered yet
  // (what is fresh belongs to another writer). The caller keeps
  // waiting rather than receiving foreign ids.
  return [];
}

/**
 * reportResult's return, from the compositions before and after the
 * call: the header's new status, and the records this write voided —
 * those voided after that were not voided before, by result row id,
 * at the per-record granularity Convex's return used.
 */
export function synthesizeReport(
  before: TournamentKnowledge,
  after: TournamentKnowledge,
): ReportResult {
  const keyByResultId = new Map(
    after.recordedResultIds.map((resultId, index) => [resultId, after.recorded[index]!.matchKey]),
  );
  const matchIdByResultId = new Map(
    after.recordedResultIds.map((resultId, index) => [resultId, after.recordedMatchIds[index]!]),
  );
  const voided: { matchId: string; matchKey: string }[] = [];
  for (const resultId of after.voidedResultIds) {
    if (!before.voidedResultIds.has(resultId)) {
      voided.push({
        matchId: matchIdByResultId.get(resultId)!,
        matchKey: keyByResultId.get(resultId)!,
      });
    }
  }
  return { status: after.status, voided };
}
