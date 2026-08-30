// Shared types of the format engine. The engine is a pure module: it never
// imports Convex, participants are opaque string ids, and everything derived
// is recomputable from (structure, results) alone (ADR 0005).

export type FormatFamily = "single_elimination" | "double_elimination";

// One union member per format family (ADR 0002). Round robin, Swiss, and
// group-into-playoffs are added as new members without touching existing ones.
export type FormatOptions =
  | { family: "single_elimination" }
  | { family: "double_elimination"; grandFinalReset: boolean };

export type BracketSection = "winners" | "losers" | "grand_final";

// Where a slot's occupant comes from; fixed at generation time.
export type SlotSource =
  | { kind: "participant"; participantId: string }
  | { kind: "bye" }
  | { kind: "winnerOf"; matchKey: string }
  | { kind: "loserOf"; matchKey: string };

export interface StructureMatch {
  // Structural key, unique within the bracket (e.g. "w1m2", "l3m1", "gf").
  key: string;
  bracket: BracketSection;
  // 1-based round within the bracket section.
  round: number;
  // 0-based position within the round.
  indexInRound: number;
  slots: [SlotSource, SlotSource];
}

export interface BracketStructure {
  format: FormatOptions;
  matches: StructureMatch[];
}

export type Outcome = "win" | "loss" | "draw" | "walkover" | "disqualification";

export interface ResultSide {
  participantId: string;
  outcome: Outcome;
  score?: number;
}

// One recorded result, in record order. Corrections append a newer record for
// the same match; the latest record per match is the effective one.
export interface RecordedResult {
  matchKey: string;
  sides: [ResultSide, ResultSide];
}

export type Occupant =
  | { kind: "participant"; participantId: string }
  | { kind: "bye" }
  | { kind: "unknown" };

// pending: at least one occupant undetermined.
// ready: two known participants, no effective result — playable now.
// completed: decided by a result, or resolved structurally by a bye.
// cancelled: structurally unnecessary (a grand-final reset that is not
// needed because the winners-side finalist won the first grand final).
export type MatchState = "pending" | "ready" | "completed" | "cancelled";

export interface DerivedMatch {
  key: string;
  bracket: BracketSection;
  round: number;
  indexInRound: number;
  state: MatchState;
  occupants: [Occupant, Occupant];
  winnerId?: string;
  loserId?: string;
  // Index into the results input of the record that decided this match.
  // Absent for bye-resolved matches.
  resultIndex?: number;
}

export interface StandingsEntry {
  participantId: string;
  placement: number;
}

export interface Progression {
  matches: DerivedMatch[];
  readyMatchKeys: string[];
  completed: boolean;
  championId?: string;
  // Sorted by placement; participants still in contention share placement 1.
  standings: StandingsEntry[];
  // Indices into the results input of records that no longer apply because a
  // correction upstream invalidated their pairing. They must be re-entered.
  voidedResultIndices: number[];
}
