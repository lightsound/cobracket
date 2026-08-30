// Public API of the format engine package. Bare re-exports promote these
// names one level out (to convex/), per the repo's ImportLint model.
export { deriveProgression, generateBracket } from "./engine";
export { FormatEngineError } from "./errors";
export type { FormatEngineErrorCode } from "./errors";
export type {
  BracketSection,
  BracketStructure,
  DerivedMatch,
  FormatFamily,
  FormatOptions,
  MatchState,
  Occupant,
  Outcome,
  Progression,
  RecordedResult,
  ResultSide,
  SlotSource,
  StandingsEntry,
  StructureMatch,
} from "./types";
