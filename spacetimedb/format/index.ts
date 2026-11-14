// Public API of the format engine package. The re-exports are tagged
// @public: since the engine moved out of convex/ (ADR 0031), its
// consumers — the Convex operations API during the migration window,
// and src/bracket's layout parity tests — sit outside the parent
// package a bare re-export would promote to. The engine files' own
// exports stay package-private; this index is the only way in.
/** @public */
export { deriveProgression, generateBracket } from "./engine";
/** @public */
export { FormatEngineError } from "./errors";
/** @public */
export type {
  BracketStructure,
  FormatOptions,
  Occupant,
  Progression,
  RecordedResult,
  ResultSide,
  SlotSource,
  StructureMatch,
} from "./types";
