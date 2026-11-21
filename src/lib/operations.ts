import type { TournamentStatus } from "../../spacetimedb/lifecycle";

// Backend-neutral operation descriptors: docs/adr/0001-mcp-first-chat-operations.md, extended by docs/adr/0031-adopt-spacetimedb-as-the-backend.md.

/** @public */
export type { TournamentStatus } from "../../spacetimedb/lifecycle";
/** @public */
export { eventAllowed } from "../../spacetimedb/lifecycle";

/** @public */
export type Format =
  | { family: "single_elimination" }
  | { family: "double_elimination"; grandFinalReset: boolean };

/** @public */
export type FormatArg =
  | { family: "single_elimination" }
  | { family: "double_elimination"; grandFinalReset?: boolean };

/** @public */
export type Outcome = "win" | "loss" | "draw" | "walkover" | "disqualification";

/** @public */
export interface ResultSideInput {
  participantId: string;
  outcome: Outcome;
  score?: number;
}

/** @public */
export interface ParticipantView {
  participantId: string;
  name: string;
  seed: number;
}

/** @public */
export type OccupantView =
  | { kind: "participant"; participantId: string }
  | { kind: "bye" }
  | { kind: "unknown" };

/** @public */
export interface MatchView {
  key: string;
  bracket: "winners" | "losers" | "grand_final";
  round: number;
  indexInRound: number;
  state: "pending" | "ready" | "completed" | "cancelled";
  occupants: OccupantView[];
  winnerId?: string;
  loserId?: string;
  sides?: ResultSideInput[];
}

/** @public */
export interface OrganizerMatchView extends MatchView {
  matchId: string;
}

/** @public */
export interface ProgressionView<Match extends MatchView> {
  matches: Match[];
  readyMatchKeys: string[];
  completed: boolean;
  championId?: string;
  standings: { participantId: string; placement: number }[];
  voidedMatchKeys: string[];
}

/** @public */
export interface TournamentView {
  name: string;
  status: TournamentStatus;
  format: Format;
  discipline: string;
  participants: ParticipantView[];
  bracket: ProgressionView<MatchView> | null;
}

/** @public */
export interface OrganizerTournamentView extends TournamentView {
  bracket: ProgressionView<OrganizerMatchView> | null;
  tournamentId: string;
  shareSlug: string;
  seeding: "random" | "manual";
}

/** @public */
export interface TournamentSummary {
  tournamentId: string;
  name: string;
  status: TournamentStatus;
  format: Format;
  discipline: string;
  shareSlug: string;
}

/** @public */
export interface CreateTournamentArgs {
  name: string;
  discipline: string;
  format: FormatArg;
}

/** @public */
export interface UpdateTournamentArgs {
  tournamentId: string;
  name?: string;
  discipline?: string;
  format?: FormatArg;
}

/** @public */
export interface ReportResult {
  status: TournamentStatus;
  voided: { matchId: string; matchKey: string }[];
}

export type SpacetimeReadKey =
  | "myTournaments"
  | "organizerTournament"
  | "sharedTournament"
  | "suggestDisciplines"
  | "currentOrganizer";

export type SpacetimeWriteKey =
  | "createTournament"
  | "updateTournament"
  | "deleteTournament"
  | "addParticipant"
  | "addParticipants"
  | "renameParticipant"
  | "removeParticipant"
  | "reorderSeeding"
  | "generateBracket"
  | "publishTournament"
  | "reportResult";

/** @public */
export interface ReadOp<Args, Result> {
  readonly kind: "read";
  readonly name: string;
  readonly spacetime: SpacetimeReadKey;
  /** Phantom carrier for the Args/Result typing; never present at runtime. */
  readonly __types?: { args: Args; result: Result };
}

/** @public */
export interface WriteOp<Args, Result> {
  readonly kind: "write";
  readonly name: string;
  readonly spacetime: SpacetimeWriteKey;
  readonly __types?: { args: Args; result: Result };
}

function read<Args, Result>(name: string, spacetime: SpacetimeReadKey): ReadOp<Args, Result> {
  return { kind: "read", name, spacetime };
}

function write<Args, Result>(name: string, spacetime: SpacetimeWriteKey): WriteOp<Args, Result> {
  return { kind: "write", name, spacetime };
}

/** @public */
export const api = {
  tournaments: {
    listMyTournaments: read<Record<string, never>, TournamentSummary[]>(
      "tournaments:listMyTournaments",
      "myTournaments",
    ),
    getTournament: read<{ tournamentId: string }, OrganizerTournamentView | null>(
      "tournaments:getTournament",
      "organizerTournament",
    ),
    createTournament: write<CreateTournamentArgs, { tournamentId: string; shareSlug: string }>(
      "tournaments:createTournament",
      "createTournament",
    ),
    updateTournament: write<UpdateTournamentArgs, null>(
      "tournaments:updateTournament",
      "updateTournament",
    ),
    deleteTournament: write<{ tournamentId: string }, null>(
      "tournaments:deleteTournament",
      "deleteTournament",
    ),
  },
  roster: {
    addParticipant: write<{ tournamentId: string; name: string }, string>(
      "roster:addParticipant",
      "addParticipant",
    ),
    addParticipants: write<{ tournamentId: string; text: string }, string[]>(
      "roster:addParticipants",
      "addParticipants",
    ),
    renameParticipant: write<{ participantId: string; name: string }, null>(
      "roster:renameParticipant",
      "renameParticipant",
    ),
    removeParticipant: write<{ participantId: string }, null>(
      "roster:removeParticipant",
      "removeParticipant",
    ),
    reorderSeeding: write<{ tournamentId: string; orderedParticipantIds: string[] }, null>(
      "roster:reorderSeeding",
      "reorderSeeding",
    ),
  },
  bracket: {
    generateBracket: write<{ tournamentId: string }, null>(
      "bracket:generateBracket",
      "generateBracket",
    ),
    publishTournament: write<{ tournamentId: string }, null>(
      "bracket:publishTournament",
      "publishTournament",
    ),
    reportResult: write<{ matchId: string; sides: ResultSideInput[] }, ReportResult>(
      "bracket:reportResult",
      "reportResult",
    ),
  },
  share: {
    getSharedTournament: read<{ shareSlug: string }, TournamentView | null>(
      "share:getSharedTournament",
      "sharedTournament",
    ),
  },
  disciplines: {
    suggestDisciplines: read<{ prefix: string }, string[]>(
      "disciplines:suggestDisciplines",
      "suggestDisciplines",
    ),
  },
  auth: {
    currentOrganizer: read<Record<string, never>, string | null>(
      "auth:currentOrganizer",
      "currentOrganizer",
    ),
  },
};
