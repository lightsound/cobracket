export type FormatFamily = "single_elimination" | "double_elimination";

export type FormatOptions =
  | { family: "single_elimination" }
  | { family: "double_elimination"; grandFinalReset: boolean };

export type BracketSection = "winners" | "losers" | "grand_final";

export type SlotSource =
  | { kind: "participant"; participantId: string }
  | { kind: "bye" }
  | { kind: "winnerOf"; matchKey: string }
  | { kind: "loserOf"; matchKey: string };

export interface StructureMatch {
  key: string;
  bracket: BracketSection;
  round: number;
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
  voidedResultIndices: number[];
}
