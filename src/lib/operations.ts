import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import { api as convexApi } from "../../convex/_generated/api";

// The operations API (ADR 0001) as backend-neutral descriptors, plus
// the contract types pages consume. This module is data only — no
// connection, no reactivity — which is what lets `src/test-fakes.ts`
// (and any test) import the real descriptors while the seam module
// beside it (`./backend`) is mocked away.
//
// The contract types are the shapes pages have always consumed — the
// Convex validators' shapes with document ids as plain strings — so
// a page cannot tell which implementation answered. Each descriptor
// carries both implementations' handles: the Convex function
// reference the Convex implementation subscribes to, and the key the
// SpacetimeDB adapter's registry is indexed by. Each descriptor's
// Args/Result are derived from its generated Convex reference at
// compile time (document ids mapped to plain strings — the seam's id
// rule), so the Convex side cannot drift from the descriptors; the
// SpacetimeDB side will be checked by the adapter against the
// generated bindings' row types its composition maps from (plan §2.5).

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
  /** The handle `reportResult` takes. Organizer surface only. */
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

// ---------------------------------------------------------------------------
// Operation descriptors
// ---------------------------------------------------------------------------

/** The SpacetimeDB read surfaces, named for the adapter's registry. */
export type SpacetimeReadKey =
  | "myTournaments"
  | "organizerTournament"
  | "sharedTournament"
  | "suggestDisciplines"
  | "currentOrganizer";

/** The SpacetimeDB write reducers, named for the adapter's registry. */
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
 * One read operation, described once for both implementations: the
 * Convex query reference the Convex implementation subscribes to, and
 * the key the SpacetimeDB adapter's feed registry is indexed by. Pages
 * pass descriptors, never implementation references, so a call site is
 * identical on either backend.
 *
 * @public
 */
export interface ReadOp<Args, Result> {
  readonly kind: "read";
  /** The operation's canonical name — attribution labels and test-fake keys. */
  readonly name: string;
  readonly convex: FunctionReference<"query">;
  readonly spacetime: SpacetimeReadKey;
  /** Phantom carrier for the Args/Result typing; never present at runtime. */
  readonly __types?: { args: Args; result: Result };
}

/**
 * One write operation; the write-side twin of {@link ReadOp}.
 *
 * @public
 */
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
 * The operations API (ADR 0001) as descriptors — the same tree shape
 * as the Convex `api` object it replaces at call sites.
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
