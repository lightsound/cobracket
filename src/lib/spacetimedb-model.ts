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
} from "./operations";

// The SpacetimeDB adapter's pure layer: everything that turns the
// generated bindings' rows into the seam's contract shapes
// (`./operations`), turns contract write arguments into reducer
// arguments, and synthesizes the write results reducers do not
// return. No connection, no reactivity: the adapter (`./spacetimedb`)
// feeds this layer snapshots of what its subscriptions currently
// hold, and the unit tests feed it fixtures.
//
// Write failures need no mirror here: a refused write delivers the
// guard's own text ("Tournament not found", "Cannot publish: …") and
// the pages print it — that text is the failure contract.
// SpacetimeDB 2.16.3 carries that contract natively: a
// reducer that throws SenderError (from spacetimedb/server) fails
// gracefully, and the calling client's promise rejects with a
// SenderError carrying the message — so the module's guards throw
// SenderError, and the adapter surfaces its message as the write's
// failure (see `./spacetimedb`). A plain throw is the host-fault
// category (InternalError) and surfaces as the one generic message
// there. (An earlier design mirrored the guards in this layer,
// after measuring only plain throws; the SenderError channel
// supersedes it — the module is again the single source of the
// texts.)

// fallow-ignore-next-line code-duplication -- intentionally mirrors the module's normalization (spacetimedb/src/lib/disciplines.ts); the client copy exists so suggestions can be filtered from cached rows without a round trip
export function normalizeDisciplineName(raw: string): { name: string; normalizedName: string } {
  // NFC canonical equivalence only — the full rationale: spacetimedb/src/lib/disciplines.ts.
  const name = raw.trim().replace(/\s+/g, " ").normalize("NFC");
  // Lowercasing can decompose (e.g. İ), so normalize again after it.
  return { name, normalizedName: name.toLowerCase().normalize("NFC") };
}

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
): Progression {
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
  return deriveProgression(structure, inputs.recorded);
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
} {
  const progression = progressionOf({
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
 * beside the composition: the composed facts a write's synthesized
 * return is read from — the roster (an add's inserted ids), the
 * recorded set with its per-record voided set (a report's return),
 * the match home index, and the header's status.
 */
export interface TournamentKnowledge {
  status: TournamentSummary["status"];
  participants: ParticipantView[];
  resultCount: number;
  recorded: RecordedResult[];
  recordedMatchIds: string[];
  matchKeyById: ReadonlyMap<string, string>;
  voidedResultIds: ReadonlySet<string>;
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
  const { bracket, progression } = composeBracket(
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
    participants,
    resultCount: results.length,
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

export function formatArgToBinding(format: FormatArg): BindingFormat {
  return format.family === "single_elimination"
    ? { tag: "SingleElimination" }
    : {
        tag: "DoubleElimination",
        value: { grandFinalReset: format.grandFinalReset ?? true },
      };
}

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

/** The bulk-entry parse, mirrored from the roster reducer. */
export function parseBulkNames(text: string): string[] {
  return text
    .split(/\r\n|\r|\n|\u2028|\u2029/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/**
 * createTournament's return, from the my_tournaments rows that
 * appeared across the call: the created row is the newest one that
 * matches the submitted name, discipline, and format. (A concurrent
 * create from another tab of the same identity can add a second
 * matching row in the same window; the newest is the best answer
 * available — a direct return would have no such ambiguity.)
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
 * at the per-record granularity the return contract uses.
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
