import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import { api as convexApi } from "../../convex/_generated/api";

// Backend-neutral operation descriptors: docs/adr/0001-mcp-first-chat-operations.md, extended by docs/adr/0031-adopt-spacetimedb-as-the-backend.md.

/** @public */
export type TournamentStatus = "draft" | "published" | "live" | "completed";

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

/**
 * One descriptor for both implementations: docs/adr/0001-mcp-first-chat-operations.md.
 *
 * @public
 */
export interface ReadOp<Args, Result> {
  readonly kind: "read";
  readonly name: string;
  readonly convex: FunctionReference<"query">;
  readonly spacetime: SpacetimeReadKey;
  /** Phantom carrier for the Args/Result typing; never present at runtime. */
  readonly __types?: { args: Args; result: Result };
}

/** @public */
export interface WriteOp<Args, Result> {
  readonly kind: "write";
  readonly name: string;
  readonly convex: FunctionReference<"mutation">;
  readonly spacetime: SpacetimeWriteKey;
  readonly __types?: { args: Args; result: Result };
}

/**
 * The seam's id rule applied to a Convex type: branded document ids
 * become plain strings, recursively; everything else passes through.
 * Deriving each descriptor's Args/Result from its generated reference
 * this way is the compile-time anchor that keeps the hand-written
 * contract types honest — a fixture or call site typed against them
 * fails `tsc` the moment the backend's real shape moves.
 */
type StringIds<T> = T extends { __tableName: string }
  ? string
  : T extends readonly (infer U)[]
    ? StringIds<U>[]
    : T extends object
      ? { [K in keyof T]: StringIds<T[K]> }
      : T;

function read<Ref extends FunctionReference<"query">>(
  name: string,
  convex: Ref,
  spacetime: SpacetimeReadKey,
): ReadOp<StringIds<FunctionArgs<Ref>>, StringIds<FunctionReturnType<Ref>>> {
  return { kind: "read", name, convex, spacetime };
}

function write<Ref extends FunctionReference<"mutation">>(
  name: string,
  convex: Ref,
  spacetime: SpacetimeWriteKey,
): WriteOp<StringIds<FunctionArgs<Ref>>, StringIds<FunctionReturnType<Ref>>> {
  return { kind: "write", name, convex, spacetime };
}

/**
 * The descriptors-as-api-tree decision: docs/adr/0001-mcp-first-chat-operations.md.
 *
 * @public
 */
export const api = {
  tournaments: {
    listMyTournaments: read(
      "tournaments:listMyTournaments",
      convexApi.tournaments.listMyTournaments,
      "myTournaments",
    ),
    getTournament: read(
      "tournaments:getTournament",
      convexApi.tournaments.getTournament,
      "organizerTournament",
    ),
    createTournament: write(
      "tournaments:createTournament",
      convexApi.tournaments.createTournament,
      "createTournament",
    ),
    updateTournament: write(
      "tournaments:updateTournament",
      convexApi.tournaments.updateTournament,
      "updateTournament",
    ),
    deleteTournament: write(
      "tournaments:deleteTournament",
      convexApi.tournaments.deleteTournament,
      "deleteTournament",
    ),
  },
  roster: {
    addParticipant: write(
      "roster:addParticipant",
      convexApi.roster.addParticipant,
      "addParticipant",
    ),
    addParticipants: write(
      "roster:addParticipants",
      convexApi.roster.addParticipants,
      "addParticipants",
    ),
    renameParticipant: write(
      "roster:renameParticipant",
      convexApi.roster.renameParticipant,
      "renameParticipant",
    ),
    removeParticipant: write(
      "roster:removeParticipant",
      convexApi.roster.removeParticipant,
      "removeParticipant",
    ),
    reorderSeeding: write(
      "roster:reorderSeeding",
      convexApi.roster.reorderSeeding,
      "reorderSeeding",
    ),
  },
  bracket: {
    generateBracket: write(
      "bracket:generateBracket",
      convexApi.bracket.generateBracket,
      "generateBracket",
    ),
    publishTournament: write(
      "bracket:publishTournament",
      convexApi.bracket.publishTournament,
      "publishTournament",
    ),
    reportResult: write("bracket:reportResult", convexApi.bracket.reportResult, "reportResult"),
  },
  share: {
    getSharedTournament: read(
      "share:getSharedTournament",
      convexApi.share.getSharedTournament,
      "sharedTournament",
    ),
  },
  disciplines: {
    suggestDisciplines: read(
      "disciplines:suggestDisciplines",
      convexApi.disciplines.suggestDisciplines,
      "suggestDisciplines",
    ),
  },
  auth: {
    currentOrganizer: read(
      "auth:currentOrganizer",
      convexApi.auth.currentOrganizer,
      "currentOrganizer",
    ),
  },
};
